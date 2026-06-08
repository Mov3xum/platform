#!/usr/bin/env bash
#
# disk-guard.sh — bevakar disk OCH inoder på Coolify/UpCloud-hosten och larmar
# innan hosten fylls (vilket tidigare kraschade Coolify).
#
# Kontrollerar för varje bevakad mountpoint:
#   * Använd andel av GB  (df -P)
#   * Använd andel av inoder (df -iP)  ← lätt att glömma; tusentals små
#     build-/loggfiler kan ta slut på inoder långt innan GB tar slut.
#   * Absolut ledigt utrymme (GB-buffert) — varnar om bufferten understiger
#     MIN_FREE_GB även om procenten ser ok ut.
#
# Trösklar: WARN vid 80 %, CRIT vid 90 % (konfigurerbart). Vid CRIT kan
# skriptet automatiskt köra docker-cleanup.sh för att försöka frigöra plats.
#
# Larm skickas till (alla som är konfigurerade):
#   * journald/syslog (alltid)
#   * webhook (ALERT_WEBHOOK_URL — Slack/Discord/Coolify/generisk JSON)
#   * e-post (ALERT_EMAIL via `mail`, om installerat)
#
# Anti-spam: larmar bara när allvarlighetsgraden ÄNDRAS (OK→WARN→CRIT) via en
# state-fil, så du inte får ett mejl var 5:e minut.
#
# Konfig läses från /etc/movexum/disk-guard.env (se disk-guard.env.example).
# Kör via systemd-timern movexum-disk-guard.timer (var 10:e minut).
#
set -euo pipefail

# ---- Konfiguration (override via env-fil eller miljövariabler) --------------
ENV_FILE="${DISK_GUARD_ENV:-/etc/movexum/disk-guard.env}"
# shellcheck disable=SC1090
[[ -f "${ENV_FILE}" ]] && source "${ENV_FILE}"

MOUNTPOINTS="${MOUNTPOINTS:-/ /var/lib/docker}"   # mellanslagsseparerad lista
WARN_PCT="${WARN_PCT:-80}"
CRIT_PCT="${CRIT_PCT:-90}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"                   # önskad ledig buffert
AUTO_CLEANUP="${AUTO_CLEANUP:-1}"                 # 1 = kör cleanup vid CRIT
CLEANUP_SCRIPT="${CLEANUP_SCRIPT:-$(dirname "$0")/docker-cleanup.sh}"
STATE_DIR="${STATE_DIR:-/var/lib/movexum}"
STATE_FILE="${STATE_DIR}/disk-guard.state"
HOSTNAME_TAG="${HOSTNAME_TAG:-$(hostname -s 2>/dev/null || echo host)}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
LOG_TAG="movexum-disk-guard"

mkdir -p "${STATE_DIR}"
touch "${STATE_FILE}"

log() { logger -t "${LOG_TAG}" -- "$*" 2>/dev/null || true; echo "[$(date -u +%FT%TZ)] $*"; }

# ---- Larmkanaler ------------------------------------------------------------
send_webhook() {
  local severity="$1" text="$2"
  [[ -z "${ALERT_WEBHOOK_URL}" ]] && return 0
  # Generisk JSON som funkar för Slack/Discord ("text"-fält) och egna mottagare.
  local payload
  payload="$(printf '{"severity":"%s","host":"%s","text":%s}' \
    "${severity}" "${HOSTNAME_TAG}" "$(json_str "${text}")")"
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "${payload}" "${ALERT_WEBHOOK_URL}" >/dev/null 2>&1 \
    || log "VARNING: kunde inte nå ALERT_WEBHOOK_URL"
}

send_email() {
  local severity="$1" text="$2"
  [[ -z "${ALERT_EMAIL}" ]] && return 0
  command -v mail >/dev/null 2>&1 || { log "mail saknas — hoppar e-postlarm"; return 0; }
  printf '%s\n' "${text}" | mail -s "[${severity}] Diskvarning ${HOSTNAME_TAG}" "${ALERT_EMAIL}" \
    || log "VARNING: kunde inte skicka e-post"
}

# Minimal JSON-strängescape (för webhook-payloaden).
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"
  printf '"%s"' "${s}"
}

alert() {
  local severity="$1" text="$2"
  log "${severity}: ${text}"
  send_webhook "${severity}" "${text}"
  send_email "${severity}" "${text}"
}

# ---- Insamling --------------------------------------------------------------
# Returnerar högsta använda procent + detaljrad rapportrad för en mountpoint.
worst_severity="OK"
report=""

escalate() { # höj global allvarlighet OK < WARN < CRIT
  case "$1" in
    CRIT) worst_severity="CRIT" ;;
    WARN) [[ "${worst_severity}" != "CRIT" ]] && worst_severity="WARN" ;;
  esac
}

for mp in ${MOUNTPOINTS}; do
  # Hoppa över mountpoints som inte finns (t.ex. /var/lib/docker på egen volym
  # saknas på vissa hostar → / täcker det ändå).
  [[ -d "${mp}" ]] || continue
  # Undvik dubbelräkning om mp ligger på samma filsystem som redan rapporterats?
  # Vi rapporterar ändå per mountpoint — df hanterar bind/överlappning ok.

  read -r used_pct avail_kb <<<"$(df -P "${mp}" | awk 'NR==2 {gsub(/%/,"",$5); print $5, $4}')"
  read -r iused_pct          <<<"$(df -iP "${mp}" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  # Vissa filsystem (t.ex. btrfs/zfs/overlay) rapporterar inga inoder → "-" eller 0.
  [[ "${iused_pct}" =~ ^[0-9]+$ ]] || iused_pct=0
  avail_gb=$(( avail_kb / 1024 / 1024 ))

  mp_sev="OK"
  reasons=""

  for metric in "disk:${used_pct}" "inoder:${iused_pct}"; do
    name="${metric%%:*}"; val="${metric##*:}"
    if (( val >= CRIT_PCT )); then mp_sev="CRIT"; reasons+="${name} ${val}% (≥${CRIT_PCT}); "
    elif (( val >= WARN_PCT )); then
      [[ "${mp_sev}" != "CRIT" ]] && mp_sev="WARN"; reasons+="${name} ${val}% (≥${WARN_PCT}); "
    fi
  done

  # Bufferttröskel: för lite absolut ledigt → minst WARN.
  if (( avail_gb < MIN_FREE_GB )); then
    [[ "${mp_sev}" == "OK" ]] && mp_sev="WARN"
    reasons+="endast ${avail_gb} GB ledigt (<${MIN_FREE_GB} GB buffert); "
  fi

  line="${mp}: disk ${used_pct}%, inoder ${iused_pct}%, ledigt ${avail_gb} GB → ${mp_sev}"
  [[ -n "${reasons}" ]] && line+=" [${reasons%%; }]"
  report+="${line}"$'\n'
  escalate "${mp_sev}"
done

report="${report%$'\n'}"

# ---- Auto-cleanup vid CRIT --------------------------------------------------
if [[ "${worst_severity}" == "CRIT" && "${AUTO_CLEANUP}" == "1" ]]; then
  if [[ -x "${CLEANUP_SCRIPT}" ]]; then
    log "CRIT — kör automatisk docker-cleanup för att frigöra disk ..."
    "${CLEANUP_SCRIPT}" || log "VARNING: cleanup-skriptet returnerade fel"
  else
    log "CRIT men CLEANUP_SCRIPT (${CLEANUP_SCRIPT}) är inte körbart."
  fi
fi

# ---- Larm bara vid förändrad allvarlighet (anti-spam) -----------------------
prev_severity="$(cat "${STATE_FILE}" 2>/dev/null || echo OK)"
[[ -z "${prev_severity}" ]] && prev_severity="OK"

if [[ "${worst_severity}" != "${prev_severity}" ]]; then
  case "${worst_severity}" in
    CRIT|WARN) alert "${worst_severity}" $'Diskbevakning '"${HOSTNAME_TAG}"$':\n'"${report}" ;;
    OK)        alert "OK" "Diskbevakning ${HOSTNAME_TAG}: tillbaka till normalt."$'\n'"${report}" ;;
  esac
  echo "${worst_severity}" > "${STATE_FILE}"
else
  log "${worst_severity} (oförändrat). ${report//$'\n'/ | }"
fi

# Exitkod speglar status (0=OK/WARN, 2=CRIT) för ev. extern övervakning.
[[ "${worst_severity}" == "CRIT" ]] && exit 2 || exit 0
