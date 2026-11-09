#!/usr/bin/env bash
# Triggar en Coolify-deploy från GitHub Actions. Delas av alla fyra
# deploy-/sync-workflows så att logik, felhantering och diagnos aldrig
# divergerar mellan kopior (jfr incidenten 2026-09-21, docs/incidents/).
#
# Indata (env):
#   COOLIFY_BASE_URL         Coolify-API:ets origin, t.ex. https://coolify.example.se
#                            (eller http://<ip>:8000 för en instans utan domän).
#   COOLIFY_TOKEN            API-token (Bearer).
#   COOLIFY_APP_UUID         Applikationens UUID, eller "<uuid>:<tag>" / "tag:<tag>"
#                            för tag-baserad deploy (innehåller ':').
#   COOLIFY_DEPLOY_WEBHOOK   Valfri: färdig deploy-webhook-URL. Vinner över UUID.
#   COOLIFY_TARGET_LABEL     Etikett i loggen, t.ex. "staging" / "production".
#   COOLIFY_UUID_SECRET_NAME Secret-namnet som ska nämnas i felmeddelanden.
#   COOLIFY_FORCE            "true" → force=true (bygg om utan cache). Default false.
#   COOLIFY_MISSING_UUID_IS_WARNING
#                            "true" → saknad UUID/webhook ger ::warning + exit 0
#                            (sync-workflows), annars ::error + exit 1.
#   COOLIFY_RETRY_DELAYS     Sekunder mellan omförsök vid transportfel/5xx,
#                            mellanslagsseparerade. Default "10 20 30 60 60"
#                            (~3 min — täcker en Coolify-omstart/auto-update).
#   COOLIFY_CONNECT_TIMEOUT / COOLIFY_MAX_TIME  curl-timeouts (s). Default 10 / 60.
#
# Utfall:
#   exit 0  deploy köad (2xx från Coolify)
#   exit 1  konfigurationsfel, auth-fel, 4xx eller Coolify nere efter alla försök
#
# Princip: vi provar ALDRIG andra origins än den konfigurerade. Coolify-API:et
# finns bara på sin egen lyssnare (port 8000 eller instansens FQDN via Traefik);
# att prova https://<ip> / http://<ip> träffar Traefiks default-router (404 +
# självsignerat cert) och skickar dessutom Bearer-tokenen till en annan
# lyssnare i klartext. Ett transportfel är ett infrastrukturfel som ska
# rapporteras ärligt, inte maskeras med fler gissningar.

set -euo pipefail

label="${COOLIFY_TARGET_LABEL:-}"
uuid_secret_name="${COOLIFY_UUID_SECRET_NAME:-COOLIFY_APP_UUID}"
connect_timeout="${COOLIFY_CONNECT_TIMEOUT:-10}"
max_time="${COOLIFY_MAX_TIME:-60}"
force="${COOLIFY_FORCE:-false}"
case "$force" in
  true|1|yes) force="true" ;;
  *) force="false" ;;
esac

read -r -a retry_delays <<< "${COOLIFY_RETRY_DELAYS:-10 20 30 60 60}"

tmpdir="$(mktemp -d)"
body_file="$tmpdir/body"
err_file="$tmpdir/curl-err"
trap 'rm -rf "$tmpdir"' EXIT

log() { printf '%s\n' "$*"; }
gh_error() { printf '::error::%s\n' "$*"; }
gh_warning() { printf '::warning::%s\n' "$*"; }

print_body() {
  if [ -s "$body_file" ]; then
    cat "$body_file"
    printf '\n'
  else
    log "(inget svar från Coolify)"
  fi
}

# --- Hjälpare: ett HTTP-anrop --------------------------------------------
# Sätter globala: http_code, curl_status, curl_error.
# Returnerar 0 om curl själv lyckades (oavsett HTTP-status).
request() {
  local method="$1" url="$2"
  http_code="000"
  curl_status=0
  curl_error=""
  : > "$body_file"
  : > "$err_file"
  http_code=$(curl -sS -X "$method" \
    --connect-timeout "$connect_timeout" \
    --max-time "$max_time" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H "Accept: application/json" \
    -o "$body_file" \
    -w '%{http_code}' \
    "$url" 2> "$err_file") || curl_status=$?
  if [ "$curl_status" -ne 0 ]; then
    curl_error="$(tr -d '\r' < "$err_file" | sed 's/^curl: //' | head -n 1)"
    http_code="000"
    return 1
  fi
  return 0
}

is_retryable_status() {
  # 5xx (inkl. 502/503/504 från en proxy framför en Coolify som startar om)
  # och 429 är övergående. Allt annat avgörs direkt.
  case "$1" in
    5??|429) return 0 ;;
    *) return 1 ;;
  esac
}

# request_with_retry METHOD URL BESKRIVNING
# Gör om anropet vid transportfel eller 5xx/429 enligt retry_delays.
# Returnerar 0 när ett icke-övergående svar erhölls (även 4xx), 1 när
# alla försök gav transportfel/5xx.
request_with_retry() {
  local method="$1" url="$2" what="$3"
  local attempt=1 total=$(( ${#retry_delays[@]} + 1 ))
  while :; do
    if request "$method" "$url"; then
      if ! is_retryable_status "$http_code"; then
        return 0
      fi
      log "$what: Coolify svarade HTTP $http_code (försök $attempt/$total)."
      print_body
    else
      log "$what: kunde inte nå Coolify (försök $attempt/$total): $curl_error"
    fi
    if [ "$attempt" -ge "$total" ]; then
      return 1
    fi
    local delay="${retry_delays[$((attempt - 1))]}"
    log "Väntar ${delay}s innan nästa försök..."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

describe_host() {
  # Host + port ur en URL, för diagnos i loggen (secreten i sig maskas av GitHub,
  # men host:port är samma sak curl redan skriver ut i sina felmeddelanden).
  node -e '
    try {
      const u = new URL(process.argv[1]);
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      process.stdout.write(`${u.hostname}:${port}`);
    } catch { process.stdout.write("(ogiltig URL)"); }
  ' "$1"
}

explain_unreachable() {
  local url="$1" hostport
  hostport="$(describe_host "$url")"
  gh_error "Coolify på $hostport svarar inte alls (senaste curl-fel: ${curl_error:-okänt}). Detta är ett INFRASTRUKTURFEL, inte ett fel i workflowet: Coolify-tjänsten är nere, porten är stängd, eller Coolify har flyttats bakom en domän."
  log "Felsökning på servern (ssh):"
  log "  docker ps --filter name=coolify            # kör coolify, coolify-db, coolify-redis, coolify-proxy?"
  log "  docker logs coolify --tail 200             # kraschloop / avbruten auto-update?"
  log "  df -h && free -m                            # disk full / OOM stoppar containrar"
  log "  ss -ltnp | grep -E ':8000|:80|:443'         # lyssnar Coolify på porten?"
  log "Om Coolify fått en egen domän (Settings → Instance's Domain) eller porten stängts i UpCloud-brandväggen:"
  log "  uppdatera GitHub-secreten COOLIFY_BASE_URL till Coolify-instansens NYA origin (helst https://<domän>)."
}

explain_server_error() {
  local url="$1" hostport
  hostport="$(describe_host "$url")"
  gh_error "Coolify på $hostport svarar men returnerar HTTP $http_code. Coolify-instansen är trasig internt (typiskt: coolify-db/coolify-redis nere, halvfärdig auto-update eller full disk). Kontrollera 'docker logs coolify --tail 200' och 'docker ps' på servern — deploy-triggern kan inte lyckas förrän instansen är frisk."
}

# --- Konfiguration ---------------------------------------------------------
if [ -z "${COOLIFY_TOKEN:-}" ]; then
  gh_error "COOLIFY_TOKEN saknas i GitHub Secrets."
  exit 1
fi

# --- Väg 1: färdig webhook-URL -------------------------------------------
if [ -n "${COOLIFY_DEPLOY_WEBHOOK:-}" ]; then
  log "Triggar Coolify-deploy${label:+ ($label)} via konfigurerad webhook..."
  if request_with_retry POST "$COOLIFY_DEPLOY_WEBHOOK" "Webhook"; then
    case "$http_code" in
      2??)
        print_body
        log "✓ Coolify-deploy köad via webhook."
        exit 0
        ;;
      401|403)
        gh_error "Coolify avvisade webhooken (HTTP $http_code). COOLIFY_TOKEN är ogiltig/utgången eller saknar behörighet."
        print_body
        exit 1
        ;;
      *)
        gh_error "Coolify-webhooken svarade HTTP $http_code."
        print_body
        exit 1
        ;;
    esac
  fi
  if [ "$curl_status" -ne 0 ]; then
    explain_unreachable "$COOLIFY_DEPLOY_WEBHOOK"
  else
    explain_server_error "$COOLIFY_DEPLOY_WEBHOOK"
  fi
  exit 1
fi

# --- Väg 2: API + app-UUID --------------------------------------------------
if [ -z "${COOLIFY_APP_UUID:-}" ]; then
  msg="Ingen Coolify-deploy-webhook och ingen app-UUID. Sätt $uuid_secret_name (eller motsvarande COOLIFY_DEPLOY_WEBHOOK_*) i GitHub Secrets."
  if [ "${COOLIFY_MISSING_UUID_IS_WARNING:-false}" = "true" ]; then
    gh_warning "$msg Hoppar över Coolify-redeploy i denna körning."
    exit 0
  fi
  gh_error "$msg"
  exit 1
fi

base_url="${COOLIFY_BASE_URL:-}"
base_url="${base_url%/}"
if [ -z "$base_url" ]; then
  gh_error "COOLIFY_BASE_URL saknas i GitHub Secrets. Sätt den till Coolify-API:ets origin, t.ex. https://coolify.<domän> (eller http://<ip>:8000 för en instans utan domän)."
  exit 1
fi
case "$base_url" in
  https://*) ;;
  http://*)
    gh_warning "COOLIFY_BASE_URL använder http:// — API-tokenen skickas i klartext (CLAUDE.md § 10.3 A.8.24). Ge Coolify-instansen en domän med TLS (Settings → Instance's Domain) och peka secreten dit."
    ;;
  *)
    gh_error "COOLIFY_BASE_URL måste börja med https:// eller http:// (fick ett värde utan schema)."
    exit 1
    ;;
esac

encoded_identifier=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$COOLIFY_APP_UUID")
deploy_param="uuid"
legacy_app_uuid="$COOLIFY_APP_UUID"
if [[ "$COOLIFY_APP_UUID" == *:* ]]; then
  deploy_param="tag"
  legacy_app_uuid="${COOLIFY_APP_UUID%%:*}"
fi

# --- Förkontroll: lever Coolify och är tokenen giltig? ---------------------
# Skiljer "Coolify är nere" (infrastruktur) från "fel i deploy-anropet"
# (konfiguration) INNAN vi tolkar ett deploy-svar.
version_url="$base_url/api/v1/version"
log "Förkontroll: $version_url"
if request_with_retry GET "$version_url" "Förkontroll"; then
  case "$http_code" in
    2??)
      log "✓ Coolify svarar (version: $(tr -d '\r\n"' < "$body_file"))."
      ;;
    401|403)
      gh_error "Coolify avvisade API-tokenen (HTTP $http_code på /api/v1/version). COOLIFY_TOKEN är ogiltig, utgången eller saknar behörighet (Keys & Tokens i Coolify)."
      print_body
      exit 1
      ;;
    404)
      gh_warning "Coolify svarar men /api/v1/version saknas (äldre Coolify?). Fortsätter med deploy-anropet."
      ;;
    *)
      gh_warning "Oväntat svar HTTP $http_code från /api/v1/version. Fortsätter med deploy-anropet."
      print_body
      ;;
  esac
else
  if [ "$curl_status" -ne 0 ]; then
    explain_unreachable "$version_url"
  else
    explain_server_error "$version_url"
  fi
  exit 1
fi

# --- Deploy-anropet ---------------------------------------------------------
# v4-API: POST /api/v1/deploy?uuid=<uuid>&force=<bool>  (eller ?tag=<tag>)
# Äldre instanser: POST /api/v1/applications/<uuid>/start?force=<bool>
deploy_v4="$base_url/api/v1/deploy?$deploy_param=$encoded_identifier&force=$force"
deploy_legacy="$base_url/api/v1/applications/$legacy_app_uuid/start?force=$force"

try_deploy() {
  local url="$1"
  log "Deploy${label:+ ($label)}: POST $url"
  if ! request_with_retry POST "$url" "Deploy"; then
    if [ "$curl_status" -ne 0 ]; then
      explain_unreachable "$url"
    else
      explain_server_error "$url"
    fi
    return 1
  fi
  case "$http_code" in
    2??)
      print_body
      log "✓ Coolify-deploy köad${label:+ ($label)}."
      return 0
      ;;
    404)
      return 2
      ;;
    401|403)
      gh_error "Coolify avvisade deploy-anropet (HTTP $http_code). Tokenen saknar behörighet för applikationen, eller $uuid_secret_name pekar på en app i ett annat team."
      print_body
      return 1
      ;;
    *)
      gh_error "Coolify svarade HTTP $http_code på deploy-anropet."
      print_body
      return 1
      ;;
  esac
}

status=0
try_deploy "$deploy_v4" || status=$?
if [ "$status" -eq 0 ]; then
  exit 0
fi
if [ "$status" -ne 2 ]; then
  exit 1
fi

if [ "$deploy_param" = "tag" ]; then
  gh_error "Coolify svarade 404 på tag-deployen. Kontrollera att taggen i $uuid_secret_name finns på minst en resurs i Coolify (Deployments → tags)."
  print_body
  exit 1
fi

log "Coolify svarade 404 på /api/v1/deploy — provar äldre endpoint..."
print_body
status=0
try_deploy "$deploy_legacy" || status=$?
if [ "$status" -eq 0 ]; then
  exit 0
fi
if [ "$status" -eq 2 ]; then
  gh_error "Coolify svarade 404 på båda deploy-endpointsen. Kontrollera att $uuid_secret_name innehåller applikationens UUID (Coolify → appen → URL:en slutar på UUID:t) och att COOLIFY_BASE_URL pekar på Coolify-instansen, inte på en deployad app."
  print_body
fi
exit 1
