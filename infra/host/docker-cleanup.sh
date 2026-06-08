#!/usr/bin/env bash
#
# docker-cleanup.sh — frigör disk genom att rensa gamla Docker-images och
# build-cache utan att röra körande containrar eller namngivna volymer.
#
# Bakgrund: Coolify pullar nya web-images vid varje deploy (se
# infra/REGISTRY-DEPLOY.md) och bygger PocketBase-image:n lokalt. Gamla,
# oanvända images + build-cache fyller annars /var/lib/docker tills hosten
# kraschar. Det här skriptet städar regelbundet (via systemd-timern
# movexum-docker-cleanup.timer).
#
# SÄKERHET:
#   * Rör ALDRIG `docker volume prune` — pb_data (PocketBase) är en namngiven
#     volym och MÅSTE överleva. Vi prunar inga volymer.
#   * Behåller images nyare än IMAGE_KEEP_HOURS (default 168 h = 7 dygn) så
#     Coolify-rollback till föregående version fortfarande fungerar.
#   * Endast oanvända (dangling/unreferenced) images tas — inget som en
#     container använder rörs.
#
#   sudo ./docker-cleanup.sh
#   IMAGE_KEEP_HOURS=72 sudo ./docker-cleanup.sh
#
set -euo pipefail

IMAGE_KEEP_HOURS="${IMAGE_KEEP_HOURS:-168}"   # behåll images/cache nyare än detta
LOG_TAG="movexum-docker-cleanup"

log() { echo "[$(date -u +%FT%TZ)] $*"; logger -t "${LOG_TAG}" -- "$*" 2>/dev/null || true; }

if ! command -v docker >/dev/null 2>&1; then
  log "docker hittades inte — hoppar över."
  exit 0
fi

before="$(docker system df 2>/dev/null || true)"
log "Före städning:"
echo "${before}"

# 1) Stoppade containrar (ej Coolify-hanterade körande — prune rör bara exited).
log "Rensar stoppade containrar ..."
docker container prune -f >/dev/null 2>&1 || true

# 2) Oanvända images äldre än fönstret. `-a` = även taggade men oreferererade
#    (gamla deploy-taggar). until-filtret skyddar de senaste för rollback.
log "Rensar oanvända images äldre än ${IMAGE_KEEP_HOURS} h ..."
docker image prune -af --filter "until=${IMAGE_KEEP_HOURS}h" >/dev/null 2>&1 || true

# 3) Build-cache äldre än fönstret (buildx/BuildKit-lager).
log "Rensar build-cache äldre än ${IMAGE_KEEP_HOURS} h ..."
docker builder prune -af --filter "until=${IMAGE_KEEP_HOURS}h" >/dev/null 2>&1 || true

# 4) Dangling build-cache (utan timestamp-filter — säkert, inga images).
docker buildx prune -f >/dev/null 2>&1 || true

log "Efter städning:"
docker system df 2>/dev/null || true

log "Klart."
