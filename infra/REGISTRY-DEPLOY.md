# Snabbare deploy: bygg i GitHub, Coolify pullar

## Problemet vi löste

Coolify byggde tidigare Next.js-imagen **på UpCloud-hosten** vid varje deploy.
`next build` + file-tracing tröskade minne i timmar (senast ~30 h) och varje
nytt deploy köades bakom det → 381 köade deploys. PocketBase byggdes också
lokalt i stacken och kunde bli en lika lång flaskhals.

## Lösningen

GitHub Actions kompilerar `apps/web/Dockerfile` på sina runners (4 vCPU /
16 GB RAM, med lager-cache) och pushar imagen till **GitHub Container
Registry (GHCR)**. Coolify slutar kompilera och **pullar bara** den färdiga
imagen — sekunder i stället för timmar. PocketBase fortsätter byggas lokalt
i Coolify eftersom den image:n är snabb att skapa och inte var den delen som
låste deployerna.

```
push → GitHub Actions (build-image.yml) → ghcr.io/mov3xum/platform-web:<tag>
                  │
            Coolify deploy webhook → docker pull → kör
```

- Image: `ghcr.io/mov3xum/platform-web`
- Taggar: `staging`, `production` (rörliga) + `sha-<commit>` (oföränderlig)
- Byggcache: GitHub Actions cache (`type=gha`) → snabba ombyggen

## Engångsinställning i Coolify (krävs)

Både web och PocketBase pullas nu från GHCR — inga lokala Docker-builds i
Coolify ska återstå.

1. **Gör GHCR-paketet pull-bart.**
   - Enklast: gör `ghcr.io/mov3xum/platform-web` **publikt** (read) under
     GitHub → Packages → Package settings → Change visibility.
   - Alternativt (om det ska vara privat): lägg till en registry-credential i
     Coolify (GHCR-användarnamn + en PAT med `read:packages`) och koppla den
     till web-resursen.

2. **Peka web-tjänsten på den förbyggda imagen.**
   - Om Coolify-resursen byggs från `infra/coolify.yml`: inget mer behövs —
     `web`-tjänsten använder nu `image: ghcr.io/mov3xum/platform-web:...`
     med `pull_policy: always`.
   - Om web-appen är en separat "Dockerfile"-resurs i Coolify-UI:t: byt dess
     **Build Pack** till **Docker Image** och sätt imagen till
     `ghcr.io/mov3xum/platform-web:staging` (resp. `:production`). Aktivera
     "pull latest image on deploy".

3. **Sätt `MOVEXUM_IMAGE_TAG`** på respektive Coolify-app:
   - staging → `staging`
   - production → `production`
   - (Osatt = `staging` via default.)

4. **Töm kön.** Avbryt de köade deployerna i Coolify och trigga en ny —
   den första pullen drar imagen som Actions redan byggt.

## Verifiera

- GitHub → Actions → "Deploy to Coolify Staging" → jobbet **build-image**
  ska bli grönt och Packages ska visa en ny `staging`-tagg.
- Coolify-deployloggen ska visa `Pulling image ...` i stället för
  `Building docker image started`.

## Residens (CLAUDE.md § 10.2)

GHCR lagrar bara den **kompilerade app-imagen** (kod) — ingen PII, ingen
kunddata, ingen PocketBase-data. Källkoden ligger redan på GitHub, så detta
inför ingen ny dataöverföring. Runtime körs fortsatt EU-only på UpCloud.

## Felsökning: deploy-triggern mot Coolify

Alla fyra workflows (`deploy.yml`, `deploy-production.yml`,
`sync-pocketbase*.yml`) triggar Coolify via **ett** delat, testat skript:
`.github/scripts/coolify-deploy.sh` (tester i `coolify-deploy.test.mjs`,
körs i `yarn test`). Det gör en förkontroll (`GET /api/v1/version`), försöker
om vid tillfälligt avbrott (~3 min) och skriver en `::error::` som säger
VILKET fel det är:

| Loggen säger | Betyder | Gör |
| --- | --- | --- |
| `svarar inte alls … INFRASTRUKTURFEL` | Coolify nere / port stängd / flyttad bakom domän | SSH: `docker ps --filter name=coolify`, `docker logs coolify`, `df -h`; uppdatera `COOLIFY_BASE_URL` om instansen fått domän |
| `svarar men returnerar HTTP 5xx … trasig internt` | Coolify uppe men db/redis/kö trasig | `docker logs coolify`, `docker ps` (coolify-db, coolify-redis), disk |
| `avvisade API-tokenen (HTTP 401/403)` | `COOLIFY_TOKEN` ogiltig | Nytt token i Coolify → Keys & Tokens |
| `404 på båda deploy-endpointsen` | `COOLIFY_APP_UUID_*` fel, eller base-URL pekar på en app i stället för Coolify | Kopiera UUID:t ur appens URL i Coolify |
| `::warning:: … använder http://` | Tokenen går i klartext | Ge Coolify en domän med TLS och peka secreten dit |

Secrets: `COOLIFY_BASE_URL` (Coolify-instansens origin — inte en deployad
apps URL), `COOLIFY_TOKEN`, `COOLIFY_APP_UUID_STAGING` /
`COOLIFY_APP_UUID_PRODUCTION` (eller en färdig
`COOLIFY_DEPLOY_WEBHOOK_STAGING` / `_PRODUCTION`, som vinner). Skriptet
provar aldrig andra origins än den konfigurerade — ett `refused` är ett
infrastrukturfel, se `docs/incidents/2026-09-21-coolify-deploy-unreachable.md`.
