#!/bin/bash
# Stop-hook: verifieringsgrind.
#
# Kör projektets självverifiering (samma grind som CI och session-start:
# typecheck + lint + unit-tester) NÄR Claude avslutar en tur OCH det finns
# kodändringar i arbetsträdet. Misslyckas något blockeras stoppet (exit 2)
# och felutdraget matas tillbaka till modellen, så loopen fortsätter tills
# allt är grönt. Mål: aldrig lämna ifrån sig trasig kod.
#
# Designval:
# - Hoppar över rena chatt-turer (inga ändringar i apps/packages/backend) så
#   vanliga frågor inte drar igång en minutslång körning.
# - Kör INTE `yarn build` (för långsamt per tur); bygget körs manuellt/CI.
#   Runtime-buggar som bara syns i bygget (t.ex. middleware-body-limit) måste
#   fortsatt repro:as för hand — den här grinden fångar typer/lint/logik.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-.}")"
cd "$ROOT" || exit 0

# Bara verifiera när kod faktiskt ändrats (snabba chatt-turer förbi).
CHANGED="$(git status --porcelain -- apps packages backend 2>/dev/null)"
if [ -z "$CHANGED" ]; then
  exit 0
fi

fail() {
  local name="$1" output="$2"
  {
    echo "🚫 Verifieringsgrinden underkände '${name}'. Lämna inte ifrån dig trasig kod — fixa och fortsätt tills typecheck + lint + test är gröna."
    echo "----- ${name} (sista 60 raderna) -----"
    printf '%s\n' "$output" | tail -60
  } >&2
  exit 2
}

if ! OUT="$(yarn typecheck 2>&1)"; then fail "yarn typecheck" "$OUT"; fi
if ! OUT="$(yarn lint 2>&1)"; then fail "yarn lint" "$OUT"; fi
if ! OUT="$(yarn test 2>&1)"; then fail "yarn test" "$OUT"; fi

exit 0
