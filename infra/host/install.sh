#!/usr/bin/env bash
#
# install.sh — installerar Movexums disk-hygien på Coolify/UpCloud-hosten:
#   1. Docker-loggrotation (daemon.json)         → loggar växer inte obegränsat
#   2. Permanent swap (setup-swap.sh)            → ingen OOM-krasch
#   3. Disk-/inodbevakning + larm (systemd-timer) → varnar vid 80/90 %
#   4. Regelbunden Docker-städning (systemd-timer)→ gamla images/cache rensas
#
# Idempotent — kan köras om. Kör som root på hosten:
#
#   git clone … && cd platform/infra/host && sudo ./install.sh
#
# Flaggor (miljövariabler):
#   SKIP_DOCKER_CONFIG=1   hoppa över daemon.json (om du inte vill starta om Docker nu)
#   SKIP_SWAP=1            hoppa över swap
#   SWAP_SIZE_GB=2         swap-storlek
#
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Måste köras som root (sudo ./install.sh)." >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR=/opt/movexum
CONF_DIR=/etc/movexum
SYSTEMD_DIR=/etc/systemd/system

echo "==> Installerar skript till ${BIN_DIR}"
install -d -m 0755 "${BIN_DIR}" "${CONF_DIR}"
install -m 0755 "${SRC_DIR}/disk-guard.sh"     "${BIN_DIR}/disk-guard.sh"
install -m 0755 "${SRC_DIR}/docker-cleanup.sh" "${BIN_DIR}/docker-cleanup.sh"
install -m 0755 "${SRC_DIR}/setup-swap.sh"     "${BIN_DIR}/setup-swap.sh"

# --- Konfig (skriv inte över befintlig riktig env-fil) -----------------------
if [[ ! -f "${CONF_DIR}/disk-guard.env" ]]; then
  install -m 0600 "${SRC_DIR}/disk-guard.env.example" "${CONF_DIR}/disk-guard.env"
  echo "==> Skapade ${CONF_DIR}/disk-guard.env (fyll i ALERT_WEBHOOK_URL / ALERT_EMAIL)"
else
  echo "==> ${CONF_DIR}/disk-guard.env finns redan — lämnar orörd"
fi

# --- 1. Docker-loggrotation --------------------------------------------------
if [[ "${SKIP_DOCKER_CONFIG:-0}" != "1" ]]; then
  echo "==> Konfigurerar Docker-loggrotation (/etc/docker/daemon.json)"
  install -d -m 0755 /etc/docker
  if [[ -f /etc/docker/daemon.json ]]; then
    cp -a /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)"
    if command -v jq >/dev/null 2>&1; then
      # Merga in log-opts utan att skriva över andra inställningar.
      tmp="$(mktemp)"
      jq -s '.[0] * .[1]' /etc/docker/daemon.json "${SRC_DIR}/daemon.json" > "${tmp}" \
        && mv "${tmp}" /etc/docker/daemon.json
    else
      echo "    VARNING: jq saknas och /etc/docker/daemon.json finns redan."
      echo "    Slå ihop log-opts från ${SRC_DIR}/daemon.json manuellt och"
      echo "    starta om Docker. Hoppar över automatisk skrivning."
    fi
  else
    install -m 0644 "${SRC_DIR}/daemon.json" /etc/docker/daemon.json
  fi
  echo "    OBS: daemon.json gäller NYA containrar. Starta om Docker när du är"
  echo "    redo (detta startar om containrarna): systemctl restart docker"
  echo "    Befintliga containrars loggar trunkeras inte retroaktivt — se README."
else
  echo "==> Hoppar över Docker-loggrotation (SKIP_DOCKER_CONFIG=1)"
fi

# --- 2. Swap -----------------------------------------------------------------
if [[ "${SKIP_SWAP:-0}" != "1" ]]; then
  echo "==> Sätter upp swap"
  "${BIN_DIR}/setup-swap.sh"
else
  echo "==> Hoppar över swap (SKIP_SWAP=1)"
fi

# --- 3 + 4. systemd-timers ---------------------------------------------------
echo "==> Installerar systemd-units"
install -m 0644 "${SRC_DIR}/systemd/movexum-disk-guard.service"      "${SYSTEMD_DIR}/"
install -m 0644 "${SRC_DIR}/systemd/movexum-disk-guard.timer"        "${SYSTEMD_DIR}/"
install -m 0644 "${SRC_DIR}/systemd/movexum-docker-cleanup.service"  "${SYSTEMD_DIR}/"
install -m 0644 "${SRC_DIR}/systemd/movexum-docker-cleanup.timer"    "${SYSTEMD_DIR}/"

systemctl daemon-reload
systemctl enable --now movexum-disk-guard.timer
systemctl enable --now movexum-docker-cleanup.timer

echo "==> Kör en första diskbevakning nu:"
"${BIN_DIR}/disk-guard.sh" || true

cat <<'EOF'

Klart. Status:
  systemctl list-timers 'movexum-*'
  systemctl status movexum-disk-guard.timer movexum-docker-cleanup.timer
  journalctl -t movexum-disk-guard -t movexum-docker-cleanup --since today

Kvar att göra manuellt:
  * Fyll i /etc/movexum/disk-guard.env (ALERT_WEBHOOK_URL och/eller ALERT_EMAIL).
  * Starta om Docker när du kan ta en kort omstart för loggrotationen:
      systemctl restart docker
EOF
