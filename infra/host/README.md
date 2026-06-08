# Disk-hygien för Coolify-hosten (UpCloud)

Den här mappen innehåller host-nivå-skript som hindrar att Coolify kraschar
igen på grund av full disk. Allt körs **på UpCloud-hosten**, inte i app-
containrarna, och installeras en gång med `install.sh`.

| Problem | Lösning | Fil |
| --- | --- | --- |
| Containerloggar växer obegränsat | Docker-loggrotation (max 10 MB × 3, komprimerat) | `daemon.json` |
| Disk/inoder tar slut tyst → krasch | Bevakning + larm vid **80 %** och **90 %** (disk **och** inoder), buffert-larm | `disk-guard.sh` + timer |
| OOM-dödar containrar vid minnesspik | Liten permanent swap (default 2 GB, låg swappiness) | `setup-swap.sh` |
| Gamla images + build-cache fyller disken | Daglig städning (behåller 7 dygn för rollback) | `docker-cleanup.sh` + timer |

## Installation

```bash
# på hosten, som root
git clone https://github.com/mov3xum/platform.git
cd platform/infra/host
sudo ./install.sh
```

`install.sh` är idempotent. Den:

1. Kopierar skripten till `/opt/movexum/`.
2. Skapar `/etc/movexum/disk-guard.env` (från exemplet) om den saknas.
3. Skriver/mergar `/etc/docker/daemon.json` (loggrotation).
4. Sätter upp swap (`setup-swap.sh`).
5. Installerar + aktiverar två systemd-timers (bevakning var 10:e min,
   städning dagligen 04:30).

### Efter installation — två manuella steg

1. **Larmkanal.** Fyll i minst en i `/etc/movexum/disk-guard.env`:
   - `ALERT_WEBHOOK_URL` — Slack/Discord/Coolify/egen mottagare (POST:ar
     JSON `{severity, host, text}`; Slack/Discord läser `text`).
   - `ALERT_EMAIL` — kräver `mail` på hosten (`apt install mailutils` eller msmtp).
2. **Loggrotation.** `daemon.json` gäller bara **nya** containrar. Aktivera
   för befintliga med en kort omstart (startar om containrarna):
   ```bash
   sudo systemctl restart docker
   ```
   Vill du undvika omstart just nu körde du `install.sh` med
   `SKIP_DOCKER_CONFIG=1` och gör det vid nästa underhållsfönster.

## Vad larmet tittar på

`disk-guard.sh` kollar **per mountpoint** (default `/` och `/var/lib/docker`):

- **GB-användning** (`df -P`) — WARN ≥ 80 %, CRIT ≥ 90 %.
- **Inod-användning** (`df -iP`) — samma trösklar. Tusentals små logg-/
  build-filer kan ta slut på inoder långt innan GB tar slut, så detta
  bevakas separat.
- **Absolut buffert** — WARN om ledigt < `MIN_FREE_GB` (default 5 GB) även
  när procenten ser ok ut.

Vid **CRIT** kör guarden automatiskt `docker-cleanup.sh` (om `AUTO_CLEANUP=1`)
för att försöka frigöra plats direkt, och larmar.

**Anti-spam:** larm skickas bara när allvarlighetsgraden *ändras*
(OK→WARN→CRIT och tillbaka), inte var 10:e minut. State i
`/var/lib/movexum/disk-guard.state`.

## Säkerhet (viktigt)

- Städningen rör **aldrig** `docker volume prune` — `pb_data` (PocketBase-
  datan) är en namngiven volym och måste överleva. Endast oanvända images,
  stoppade containrar och build-cache rensas.
- `IMAGE_KEEP_HOURS=168` (7 dygn) gör att **Coolify-rollback** till
  föregående version fortfarande fungerar — bara äldre images tas.
- Inga hemligheter i repot. `disk-guard.env` (webhook/mejl) ligger bara på
  hosten med `chmod 600`.

## Drift / felsökning

```bash
# När kör timrarna härnäst?
systemctl list-timers 'movexum-*'

# Logg
journalctl -t movexum-disk-guard -t movexum-docker-cleanup --since today

# Kör manuellt på begäran
sudo /opt/movexum/disk-guard.sh
sudo /opt/movexum/docker-cleanup.sh

# Nuläge för disk + inoder
df -hP /  /var/lib/docker
df -ihP / /var/lib/docker
docker system df
```

## Justera trösklar / cadence

- Trösklar, mountpoints, buffert, auto-cleanup: redigera
  `/etc/movexum/disk-guard.env` (ingen omstart krävs).
- Hur ofta bevakningen körs: `systemd/movexum-disk-guard.timer`
  (`OnUnitActiveSec`).
- När städningen körs / hur länge images sparas:
  `systemd/movexum-docker-cleanup.timer` (`OnCalendar`) resp.
  `...service` (`Environment=IMAGE_KEEP_HOURS=...`). Efter ändring i unit-
  filer: kör om `install.sh` eller `systemctl daemon-reload`.

## Avinstallera

```bash
sudo systemctl disable --now movexum-disk-guard.timer movexum-docker-cleanup.timer
sudo rm /etc/systemd/system/movexum-{disk-guard,docker-cleanup}.{service,timer}
sudo systemctl daemon-reload
# swap, daemon.json och /opt/movexum lämnas kvar avsiktligt
```
