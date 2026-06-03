# Snabbare deploy: bygg i GitHub, Coolify pullar

## Problemet vi löste

Coolify byggde tidigare Next.js-imagen **på UpCloud-hosten** vid varje deploy.
`next build` + file-tracing tröskade minne i timmar (senast ~30 h) och varje
nytt deploy köades bakom det → 381 köade deploys. PocketBase byggdes också
lokalt i stacken och kunde bli en lika lång flaskhals.

## Lösningen

GitHub Actions kompilerar både `apps/web/Dockerfile` och
`backend/pocketbase-schema/Dockerfile` på sina runners (4 vCPU / 16 GB RAM,
med lager-cache) och pushar images till **GitHub Container Registry
(GHCR)**. Coolify slutar kompilera och **pullar bara** de färdiga images —
sekunder i stället för timmar.

```
push → GitHub Actions (build-image.yml + build-pocketbase-image.yml)
  → ghcr.io/mov3xum/platform-web:<tag>
  → ghcr.io/mov3xum/platform-pocketbase:<tag>
                  │
            Coolify deploy webhook → docker pull → kör
```

- Images: `ghcr.io/mov3xum/platform-web` och `ghcr.io/mov3xum/platform-pocketbase`
- Taggar: `staging`, `production` (rörliga) + `sha-<commit>` (oföränderlig)
- Byggcache: GitHub Actions cache (`type=gha`) → snabba ombyggen

## Engångsinställning i Coolify (krävs)

Både web och PocketBase pullas nu från GHCR — inga lokala Docker-builds i
Coolify ska återstå.

1. **Gör GHCR-paketen pull-bara.**
   - Enklast: gör `ghcr.io/mov3xum/platform-web` och
     `ghcr.io/mov3xum/platform-pocketbase` **publika** (read) under
     GitHub → Packages → Package settings → Change visibility.
   - Alternativt (om det ska vara privat): lägg till en registry-credential i
     Coolify (GHCR-användarnamn + en PAT med `read:packages`) och koppla den
     till båda resurserna.

2. **Peka web-tjänsten på den förbyggda imagen.**
   - Om Coolify-resursen byggs från `infra/coolify.yml`: inget mer behövs —
     både `web`- och `pocketbase`-tjänsten använder nu `image:
     ghcr.io/mov3xum/platform-...:...` med `pull_policy: always`.
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

- GitHub → Actions → "Deploy to Coolify Staging" → jobben **build-image**
  och **build-pocketbase-image** ska bli gröna och Packages ska visa nya
  `staging`-taggar.
- Coolify-deployloggen ska visa `Pulling image ...` i stället för
  `Building docker image started`.

## Residens (CLAUDE.md § 10.2)

GHCR lagrar bara den **kompilerade app-imagen** (kod) — ingen PII, ingen
kunddata, ingen PocketBase-data. Källkoden ligger redan på GitHub, så detta
inför ingen ny dataöverföring. Runtime körs fortsatt EU-only på UpCloud.
