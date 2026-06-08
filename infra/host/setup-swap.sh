#!/usr/bin/env bash
#
# setup-swap.sh — skapa en liten permanent swap på Coolify/UpCloud-hosten.
#
# Varför: en host helt utan swap OOM-dödar containrar (PocketBase/web) vid
# minnesspikar. En liten permanent swap (default 2 GB) ger andrum utan att
# göra disken till primärminne. Låg swappiness → swap används bara vid behov.
#
# Idempotent: hoppar över om swap redan finns. Kör som root.
#
#   sudo ./setup-swap.sh            # 2 GB (default)
#   SWAP_SIZE_GB=4 sudo ./setup-swap.sh
#
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
SWAPPINESS="${SWAPPINESS:-10}"
VFS_CACHE_PRESSURE="${VFS_CACHE_PRESSURE:-50}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Måste köras som root (sudo)." >&2
  exit 1
fi

# Redan aktiv swap någonstans? Lämna värden i fred.
if [[ -n "$(swapon --show --noheadings 2>/dev/null || true)" ]]; then
  echo "Swap finns redan aktiv:"
  swapon --show
else
  echo "Skapar ${SWAP_SIZE_GB} GB swap på ${SWAP_FILE} ..."

  # Kontrollera att det finns plats på disken för swapfilen + lite marginal.
  target_dir="$(dirname "${SWAP_FILE}")"
  avail_mb="$(df -Pm "${target_dir}" | awk 'NR==2 {print $4}')"
  need_mb="$(( SWAP_SIZE_GB * 1024 + 512 ))"
  if [[ "${avail_mb}" -lt "${need_mb}" ]]; then
    echo "FEL: bara ${avail_mb} MB ledigt på ${target_dir}, behöver ~${need_mb} MB." >&2
    echo "Frigör disk (kör docker-cleanup.sh) eller välj mindre SWAP_SIZE_GB." >&2
    exit 1
  fi

  # fallocate är snabbt; faller tillbaka på dd om filsystemet inte stödjer det.
  if ! fallocate -l "${SWAP_SIZE_GB}G" "${SWAP_FILE}" 2>/dev/null; then
    dd if=/dev/zero of="${SWAP_FILE}" bs=1M count="$(( SWAP_SIZE_GB * 1024 ))" status=progress
  fi

  chmod 600 "${SWAP_FILE}"
  mkswap "${SWAP_FILE}"
  swapon "${SWAP_FILE}"

  # Persistens över omstart.
  if ! grep -qsE "^[^#]*[[:space:]]${SWAP_FILE}[[:space:]]" /etc/fstab \
     && ! grep -qsE "^${SWAP_FILE}[[:space:]]" /etc/fstab; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
    echo "La till ${SWAP_FILE} i /etc/fstab."
  fi
fi

# Sänk swappiness så swap bara används vid faktisk minnespress (persistent).
sysctl -w "vm.swappiness=${SWAPPINESS}" >/dev/null
sysctl -w "vm.vfs_cache_pressure=${VFS_CACHE_PRESSURE}" >/dev/null
cat > /etc/sysctl.d/99-movexum-swap.conf <<EOF
# Hanteras av infra/host/setup-swap.sh
vm.swappiness = ${SWAPPINESS}
vm.vfs_cache_pressure = ${VFS_CACHE_PRESSURE}
EOF

echo "Klart. Aktuell swap/minne:"
free -h
