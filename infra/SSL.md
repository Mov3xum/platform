# SSL/TLS — staging & production

Staging och production körs bakom Coolifys Traefik-proxy. Det här dokumentet
beskriver hur HTTPS slås på med **Let's Encrypt** och vad som måste stämma i
appens env-vars. **OBS:** för https krävs i praktiken en **egen domän** —
`*.sslip.io` delar en global, regelbundet uttömd LE-kvot (se varningen under
"Steg per service").

Själva cert-utfärdandet görs i **Coolify-UI:t** — det kan inte göras från
repot. Appen är redan byggd för att auto-detektera HTTPS via
`x-forwarded-proto` (sätts av Traefik): så fort proxyn terminerar TLS slås
`Secure`-cookies (`apps/web/src/lib/actions/auth.ts`) och CSP-direktivet
`upgrade-insecure-requests` (`apps/web/src/middleware.ts`) på automatiskt.

Dessutom **tvingar appen själv https** (defense-in-depth ovanpå Coolifys
force-https-toggle): middleware:n svarar `308` → `https://<host><path>` när
en request kommer in med `x-forwarded-proto: http` i produktion. Redirecten
triggas ALDRIG för container-interna anrop (Coolify-healthchecks, PB-hookarnas
POST mot `http://moveum-web:3000`) — de saknar `x-forwarded-proto`-headern —
och `/api/health` + `/api/internal/` är dessutom explicit undantagna.
`MOVEXUM_ALLOW_INSECURE_COOKIES=true` stänger av redirecten för en medvetet
http-serverad deploy (samma escape-hatch som Secure-cookies).

## Ordning (viktigt)

Slå på TLS + force-https i Coolify **först** och verifiera certet. Deploya
**sedan** koden. Annars triggas `upgrade-insecure-requests` mot en host utan
https-lyssnare → alla subresurser (CSS/JS/fonter) fallerar och sidan blir
ostylad.

## Steg per service

Gäller alla fyra: web-staging, web-production, pocketbase-staging,
pocketbase-production.

1. **Coolify → appen → Configuration → Domains.** Sätt FQDN med `https://`-
   schema, t.ex. `https://pb.movexum.se` (egen domän — se avsnittet nedan;
   inte en sslip-host). Coolify använder schemat för att be Traefik om ett
   Let's Encrypt-cert.
2. **Brandvägg (UpCloud):** öppna port **80 och 443** mot hosten.
   LE:s HTTP-01-challenge kräver att :80 är nåbar; :443 serverar TLS.
3. **Force HTTPS:** slå på Coolifys redirect-toggle → http→https 301 på
   proxynivå.
4. **Save + Redeploy.** Traefik begär certet vid första anropet (~30 s).
5. **Verifiera:** `curl -I https://<host>` ger giltigt cert;
   `curl -I http://<host>` ger `301` → https.

> **VARNING — https på sslip.io fungerar i praktiken INTE.** Tidigare stod
> här att varje `*.sslip.io`-host är en egen Public Suffix List-entry — det
> är FEL. sslip.io finns inte i PSL, så hela världens `*.sslip.io`-cert
> delar EN gemensam Let's Encrypt-kvot (höjd till 50 000 cert/vecka), och
> den töms regelbundet (cunnie/sslip.io#108, feb 2026: "too many
> certificates (50000) already issued for sslip.io"). Coolify varnar därför
> uttryckligen när https sätts på en sslip-domän. Utfärdandet kan råka
> lyckas, men förnyelsen (~var 60:e dag) kan lika gärna faila → certet dör
> tyst i drift. **Använd en egen domän för https** (se nedan); sslip.io
> duger bara för tillfällig http.

## Egen domän (krävs i praktiken för https)

1. Välj subdomäner på en domän ni kontrollerar (exempel med `movexum.se`):
   `app.movexum.se` (web-production), `staging.movexum.se` (web-staging),
   `pb.movexum.se` / `pb-staging.movexum.se` (PocketBase).
2. Skapa **A-poster** hos DNS-leverantören som pekar på serverns publika IP
   (`212.147.227.223`). Vänta tills de resolvar (`dig +short app.movexum.se`).
3. Använd dessa FQDN:er med `https://`-schema i "Steg per service" ovan.
   Let's Encrypts rate-limit (50 cert/vecka per registrerad domän) gäller då
   er egen domän — långt ifrån ett problem.
4. Uppdatera env-vars (tabellen nedan) till de nya https-hostarna.

## Env-vars i Coolify (båda web-apparna, efter att cert är på plats)

| Variabel | Värde |
|---|---|
| `POCKETBASE_URL_STAGING` / `_PRODUCTION` | `https://…sslip.io` |
| `NEXT_PUBLIC_POCKETBASE_URL_STAGING` / `_PRODUCTION` | `https://…sslip.io` |
| `NEXT_PUBLIC_APP_URL` | `https://<web-host>` (per miljö; används i verifieringsmail) |
| `MOVEXUM_ALLOW_INSECURE_COOKIES` | **rensa / ≠ `true`** → Secure-cookies + upgrade-insecure-requests slås på |

Lämna oförändrat (internt docker-nät, ingen TLS internt):

- `POCKETBASE_URL` / `NEXT_PUBLIC_POCKETBASE_URL` = `http://pocketbase:8080`
- `MOVEXUM_WEB_URL` (PB-hooks) = `http://moveum-web:3000` — hookarna anropar
  web-containern container-till-container.

> **OBS för en http-only-deploy (utan cert):** app-redirecten ovan aktiveras
> av att Traefik skickar `x-forwarded-proto: http`. Kör en miljö medvetet
> utan TLS måste `MOVEXUM_ALLOW_INSECURE_COOKIES=true` vara satt — annars
> redirectas besökaren till en https-lyssnare som inte finns.

## Verifiering efter deploy

- `curl -I https://<web-host>` → `200` + giltigt cert; `http://` → `301`
  (Coolify-proxyn) eller `308` (appens egen force-https-redirect).
- `curl -fsS https://<pb-host>/api/health` → `200`.
- Login över https → DevTools ▸ Application ▸ Cookies: `pb_auth` har `Secure` ✓.
- Response-headers: `Strict-Transport-Security` finns + CSP innehåller
  `upgrade-insecure-requests`.
- Avatarer (next/image från PocketBase) laddar över https — inga
  mixed-content-varningar i konsolen.
- Konsol-koll: CSP har `connect-src 'self'`. Om klientkod anropar PB-origin
  direkt (realtime) och blockeras → en separat `connect-src`-justering för
  PB-hosten kan behövas. Troligen server-proxat; bekräfta att inga
  `connect-src`-fel dyker upp.
