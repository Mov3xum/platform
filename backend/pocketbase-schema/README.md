# PocketBase-schema för Moveum-plattformen

JS-migrations som körs automatiskt vid PocketBase-start. Mappstrukturen mountas in i containern via `infra/coolify.yml`:

```
backend/pocketbase-schema/
├── migrations/   → /pb_migrations  (kör automatiskt vid start)
└── hooks/        → /pb_hooks       (JS event-hooks, valfritt)
```

PocketBase-data (SQLite) skrivs till `/pb_data` i containern. Mounten i Coolify pekar på en namnad volym (`pb_data`).

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
| `phase` | select: `idea`, `pre_revenue`, `early_revenue`, `growth`, `scale`, `exit` |
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
docker compose -f infra/coolify.yml up pocketbase
# eller direkt:
pocketbase serve --http=0.0.0.0:8080 --dir=./pb_data --migrationsDir=./backend/pocketbase-schema/migrations
```

Första uppstart kör alla migrations, inklusive seed av tenant `movexum`.

## Lägga till en migration

PocketBase kan generera migrations från ändringar i admin-UI:
```bash
pocketbase migrate collections
```

Eller skriv för hand: filnamn `<unix-ts>_<beskrivning>.js`, exportera `migrate(up, down)`.
