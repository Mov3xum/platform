# SSL/TLS — staging & production

Staging och production körs på `*.sslip.io`-hostnames bakom Coolifys
Traefik-proxy. Det här dokumentet beskriver hur HTTPS slås på med **Let's
Encrypt** och vad som måste stämma i appens env-vars.

Själva cert-utfärdandet görs i **Coolify-UI:t** — det kan inte göras från
repot. Appen är redan byggd för att auto-detektera HTTPS via
`x-forwarded-proto` (sätts av Traefik): så fort proxyn terminerar TLS slås
`Secure`-cookies (`apps/web/src/lib/actions/auth.ts`) och CSP-direktivet
`upgrade-insecure-requests` (`apps/web/src/middleware.ts`) på automatiskt.

## Ordning (viktigt)

Slå på TLS + force-https i Coolify **först** och verifiera certet. Deploya
**sedan** koden. Annars triggas `upgrade-insecure-requests` mot en host utan
https-lyssnare → alla subresurser (CSS/JS/fonter) fallerar och sidan blir
ostylad.

## Steg per service

Gäller alla fyra: web-staging, web-production, pocketbase-staging,
pocketbase-production.

1. **Coolify → appen → Configuration → Domains.** Sätt FQDN med `https://`-
   schema, t.ex.
   `https://pocketbase-r10nklch8dkune7s0flczb89.212.147.227.223.sslip.io`.
   Coolify använder schemat för att be Traefik om ett Let's Encrypt-cert.
2. **Brandvägg (UpCloud):** öppna port **80 och 443** mot hosten.
   LE:s HTTP-01-challenge kräver att :80 är nåbar; :443 serverar TLS.
3. **Force HTTPS:** slå på Coolifys redirect-toggle → http→https 301 på
   proxynivå.
4. **Save + Redeploy.** Traefik begär certet vid första anropet (~30 s).
5. **Verifiera:** `curl -I https://<host>` ger giltigt cert;
   `curl -I http://<host>` ger `301` → https.

> Let's Encrypt funkar för sslip.io: varje `*.sslip.io`-host är en egen
> entry i Public Suffix List, så per-domän-rate-limits gäller per host (inte
> hela sslip.io). Ett fåtal hosts ligger gott inom gränserna.

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

## Verifiering efter deploy

- `curl -I https://<web-host>` → `200` + giltigt cert; `http://` → `301`.
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
