# PocketBase-schema för Moveum-plattformen

JS-migrations som körs automatiskt vid PocketBase-start. Migrationerna och hooks **bakas in i Docker-image:n** via `Dockerfile` i denna mapp — de mountas alltså inte som volym, utan följer med koden.

```
backend/pocketbase-schema/
├── Dockerfile         # bygger PB-image med pocketbase-binär + migrations + hooks
├── migrations/        # JS-migrations, körs i ordning vid första start
└── hooks/             # JS event-hooks (valfritt)
```

PocketBase-data (SQLite) skrivs till `/pb_data` i containern. **Endast** `/pb_data` behöver persistent volym — migrations + hooks är redan i image:n.

## Deploy via Coolify

1. Skapa en **Application**-resurs i Coolify (typ: **Dockerfile**)
2. **Git Source:** peka på `Mov3xum/platform`-repot, gren `staging`
3. **Base Directory:** `backend/pocketbase-schema`
4. **Persistent Storage:** mounta volym → `/pb_data`
5. **Environment Variables** (Secrets):
   - `APP_ADMIN_INITIAL_PASSWORD` — sätts vid första deploy så `hampus@movexum.se` seedas. Töm efter första lyckad login.
   - `POCKETBASE_ENCRYPTION_KEY` — valfritt, krypterar känsliga PB-fält
6. **Redeploy** → migrationerna körs automatiskt → schema + Movexum-tenant + (om secret är satt) Hampus app-admin skapas

### Staging via GitHub Actions

Workflowen `.github/workflows/deploy.yml` kör nu även en idempotent PocketBase-bootstrap efter staging-deploy för att säkerställa att workshops- och toolbox-collections finns.

Sätt följande repo-secrets för staging:

- `PB_URL_STAGING` (fallback: `PB_URL`)
- `PB_SU_PASSWORD_STAGING` (fallback: `PB_SU_PASSWORD`)
- `PB_SU_EMAIL_STAGING` (valfritt, default `hampus@movexum.se`)
- `APP_USER_PASSWORD_STAGING` (valfritt om app-user redan finns)

Koden i web-appen behöver `NEXT_PUBLIC_POCKETBASE_URL` pekande på PB:s publika domän.

## Datamodell

### `tenants`
Multi-tenant root. Alla affärsdata-collections har `tenant`-relation.

| fält | typ | not |
|---|---|---|
| `name` | text | "Movexum" |
| `slug` | text (unique) | url-säker |
| `type` | select | `incubator` \| `partner_org` |

### `users` (utökar PocketBase auth)
| fält | typ | not |
|---|---|---|
| `tenant` | relation→tenants | required |
| `roles` | select multi | `admin`, `incubator_lead`, `coach`, `mentor`, `partner`, `startup_member`, `observer` |
| `display_name` | text | |
| `linked_startups` | relation→startups (max 50) | för startup_member/coach/mentor |

### `startups`
| fält | typ |
|---|---|
| `tenant`, `name`, `description` | relation, text, editor |
| `phase` | select: `paus`, `inflode`, `lead`, `boost_chamber`, `incubation`, `prescale`, `acceleration`, `alumni` |
| `irl_level` | number 1–9 |
| `next_step` | text |
| `owner` | relation→users (1) |
| `coaches` | relation→users (max 10) |
| `status` | select: `active`, `alumni`, `paused`, `rejected` |
| `tags` | text |

### `partners`
| fält | typ |
|---|---|
| `tenant`, `name`, `type` | relation, text, select (`investor`, `corporate`, `public`, `academic`, `other`) |
| `contact_user`, `website`, `notes` | relation→users, url, editor |

### Relations & aktivitet
- `startup_team_members` — gründare/anställda per startup (länkad till user eller fritext)
- `partner_engagements` — partner ↔ startup, typ (`investment` / `pilot` / `mentorship` / `customer` / `loi` / `other`), belopp, datum
- `activities` — möten, samtal, uppgifter (med owner, due_date, status)
- `notes` — interna anteckningar (kan markeras `confidential`)
- `agreements` — NDA, inkubatoravtal, IP-tilldelning (PDF-bilaga)
- `milestones` — målsättningar per kategori (product/market/team/funding/sustainability)

## Access rules

Alla collections följer mönstret:
```
@request.auth.id != "" && @request.auth.tenant = tenant
```

Skrivåtkomst per roll (uttryck via `@request.auth.roles ?= "rolename"`):
- **Skapa/uppdatera startup, partner, milestone, team_member, partner_engagement** — `admin` / `incubator_lead` / `coach`
- **Skapa/uppdatera agreement** — `admin` / `incubator_lead` enbart
- **Activities** — alla i tenant kan skapa, owner eller staff kan uppdatera/ta bort
- **Notes** — endast författaren kan uppdatera, staff och författare kan se konfidentiella
- **Delete** — generellt enbart `admin`

## Lokal körning

```bash
# Bygg image från denna mapp och kör
docker build -t moveum-pocketbase backend/pocketbase-schema
docker run --rm -p 8080:8080 \
  -v moveum-pb-data:/pb_data \
  -e APP_ADMIN_INITIAL_PASSWORD=test1234 \
  moveum-pocketbase

# Eller hela stacken (PB + Next.js)
APP_ADMIN_INITIAL_PASSWORD=test1234 docker compose -f infra/coolify.yml up
```

Vid första uppstart kör PB alla 13 migrations i ordning. Sista migrationen seedar `hampus@movexum.se` i `users` om `APP_ADMIN_INITIAL_PASSWORD` är satt.

## Lägga till en migration

Skriv för hand: filnamn `<unix-ts>_<beskrivning>.js`, exportera `migrate(up, down)` i v0.23+ syntax (`app` som första parameter, `app.save()`, `fields:[...]`).

Eftersom migrationerna bakas in i image:n krävs **redeploy av PB-resursen** för att nya migrations ska köras.

### Standalone PB utan vår custom-image

Om PB körs som en vanlig standalone-container (utan vår Dockerfile som bakar in migrationerna) så applicerar de sig **aldrig** automatiskt. Då måste motsvarande schema-ändring också läggas till i `scripts/setup-via-api.mjs` i samma commit:

- Ny collection → lägg till en `ensureCollection({...})`-anrop med samma fält och regler som migrationen.
- Nytt fält på befintlig collection → använd matchande patch-helper (`patchTenantsCollection`, `patchUsersCollection`, `patchToolRunsCollection`, `patchActivitiesCollection`).
- Nytt värde i ett select-fält (t.ex. `activities.kind`) → använd `patchActivitiesKindValues`.

Staging-flödet kör nu PocketBase-sync automatiskt från `.github/workflows/deploy.yml` när en merge till `staging` innehåller PocketBase-påverkande filer (t.ex. `backend/pocketbase-schema/**`). Deploy-workflowen anropar då `.github/workflows/sync-pocketbase.yml`, som först triggar Coolify-redeploy av PB-stacken och sedan kör `setup-via-api.mjs` mot staging-instansen (`PB_URL_STAGING` när den är satt, annars `PB_URL`). Resultatet: schemaändringar från Claude-feature-grenar följer med automatiskt när de mergas till `staging`.

Automatisk sync körs **inte** för vanliga staging-merger utan PB-beröring, och den gäller inte produktion (`main` använder sin separata production-workflow). Om staging-syncen ändå behöver köras manuellt — t.ex. efter sekret- eller driftproblem — använd `Sync PocketBase schema`-workflowen via **Run workflow** i GitHub Actions.

## Bootstrap utan PB-redeploy (`scripts/setup-via-api.mjs`)

Om PB redan körs (t.ex. från en raw `pocketbase/pocketbase`-image utan vår Dockerfile) och du inte kan reconfigura/redeploya den just nu, kan du seeda hela schemat + Hampus app-user via API istället.

Kräver att du har en PocketBase superuser (`_superusers`-rad) — den skapas vid första `/_/`-besök på en fresh PB.

```bash
# Kör från repo-roten
PB_URL='https://pocketbase-r10nkich8dkune7s0flczb89.212.147.227.223.sslip.io' \
PB_SU_EMAIL='hampus@movexum.se' \
PB_SU_PASSWORD='<ditt PB-superuser-lösen>' \
APP_USER_PASSWORD='<lösen för login i webappen (krävs bara om app-user saknas)>' \
node backend/pocketbase-schema/scripts/setup-via-api.mjs
```

Skriptet är idempotent — om en collection eller record redan finns hoppas den över. Efter körning:
- 17 collections (`tenants`, `users` utökad, `startups`, `partners`, `startup_team_members`, `partner_engagements`, `activities` (utökad med tools + workshops), `notes`, `agreements`, `milestones`, `tools`, `tool_runs`, `workshops`, `workshop_assignments`, `workshop_runs`)
- 1 tenant: `Movexum`
- 1 app-user: `hampus@movexum.se` med `roles=["admin"]`

Du kan nu logga in på `<din-web-url>/login` med Hampus-credentials.
