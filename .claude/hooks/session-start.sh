#!/bin/bash
# SessionStart-hook för Claude Code on the web.
#
# Installerar dependencies så att agenten kan köra yarn typecheck / lint /
# test / verify:pb-baseline direkt i en cloud-session — utan att en
# maintainer behöver göra det manuellt. Speglar CI-grinden
# (.github/workflows/ci.yml) så att en agent kan självverifiera lokalt
# innan den öppnar en PR.
set -euo pipefail

# Kör bara i remote-miljö (Claude Code on the web). Lokala dev-maskiner
# sköter sin egen install.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# yarn classic, frozen lockfile (matchar CI). --ignore-engines ligger redan
# i .yarnrc. Idempotent: kör om utan biverkningar, behåller cachad
# node_modules mellan körningar.
yarn install --frozen-lockfile
