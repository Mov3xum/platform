# Impact Navigator — hållbarhetsanalysen inbyggd i plattformen

> Den tidigare fristående appen (`inkubator-kohl.vercel.app`, kallad
> "Sales Navigator") är ersatt av modulen **Impact Navigator** på
> `app.movexum.se/impactnavigator`. Datamodellen och historiken importeras
> ur den gamla appens Postgres-dump. Bindande regler: CLAUDE.md § 56.
> Detta dokument är runbooken för importen och en karta över koden.

## 1. Vad den gamla appen var (ur dumpen 2026-10-14)

Dumpen (`movexum.dump`, pg_dump 18.6, 9 tabeller, 167 rader) visar en
**AI-stödd hållbarhetsanalys per bolag**: väsentlighetsanalys av ESG-aspekter
(`OWN-ENV-01`, `OWN-SOC-01`, `OWN-GOV-01` …), tillräcklighetsprövning med
kompletteringsfrågor, en slutanalys (risker, möjligheter, greenwashing-risker,
diskussionsfrågor, impactnivå) och versionerade uppdateringsanalyser.
Modellen i källan var OpenAI `gpt-5.6` (US); den inbyggda modulen kör
**Mistral** (FR, EU) — se § 5.

| Källa (Postgres) | Rader | Hos oss | Anm. |
|---|---|---|---|
| `User` | 5 | `users` (FINNS) | Matchas på e-post vid import. `passwordHash`/`clerkUserId` importeras aldrig. |
| `Company` | 9 | `startups` (FINNS) | `name`→`name`, `phase`→`phase` (mappad), `industry`→`industri`. **Tillagt:** `sustainability_journey_text`, `sustainability_status`, `sustainability_assigned_to`. |
| `Note` | 5 | `notes` (FINNS) | Klartext → escapad `<p>`-HTML, `confidential=false`. |
| `Assessment` | 22 | `sustainability_assessments` (NY) | Unik `(startup, version)`; `previous_assessment` self-relation. |
| `GapQuestion` | 31 | `sustainability_gap_questions` (NY) | |
| `MaterialityOverride` | 4 | `sustainability_materiality_overrides` (NY) | |
| `UpdateEvent` | 13 | `sustainability_update_events` (NY) | |
| `Document` | 20 | `sustainability_documents` (NY) | `file` = riktigt PB-filfält (protected). Originalfilerna (Vercel Blob) ingår **inte** i dumpen — importerade rader har bara `extracted_text` + `storage_path`. `openaiFileId` importeras inte. |
| `AIJob` | 58 | `sustainability_ai_jobs` (NY) | Audit per modellkörning (art. 12). |

Fasmappning `CompanyPhase` → `startups.phase`: SCREENING→`lead`,
BOOST_CHAMBER→`boost_chamber`, INKUBATOR→`incubation`,
ACCELERATOR→`acceleration`, ALUMNI→`alumni`, EXIT→`alumni`. Enum-värden är
källans i gemener (källa av sanning
`backend/pocketbase-schema/scripts/lib/sustainability-import.mjs` ↔
`packages/shared/src/impact-navigator.ts`, speglade i migration 1700000206 och
låsta av enhetstest). Varje ny kollektion bär `external_id` (källans cuid,
idempotent import) och `source_created_at` (källans tidsstämpel).

## 2. Kodkarta

| Fil | Syfte |
|---|---|
| `backend/pocketbase-schema/migrations/1700000206_create_sustainability_analysis.js` | Schema (startups-fält + sex kollektioner), RLS |
| `backend/pocketbase-schema/migrations/1700000207_backfill_enabled_modules_impactnavigator.js` | Modulen i befintliga användares sidmeny (§ 36.3) |
| `packages/shared/src/impact-navigator.ts` (+ `.test.ts`) | REN domän: vokabulär, etiketter, normalisering av AI-svar, justeringar, statusmaskin, underlagsbygge |
| `apps/web/src/lib/impact/data.ts` | Enda läsvägen (användartoken → RLS) |
| `apps/web/src/lib/ai/impact-analysis.ts` | Fyra Mistral-steg (väsentlighet, tillräcklighet, slutanalys, uppdatering) |
| `apps/web/src/lib/actions/impact.ts` | Server actions (RBAC, skrivningar, AI-steg, audit, budget) |
| `apps/web/src/app/api/impactnavigator/documents/route.ts` | Uppladdning + textextraktion (route handler) |
| `apps/web/src/app/api/impactnavigator/documents/[id]/file/route.ts` | Tenant-scopad filproxy (protected file) |
| `apps/web/src/app/impactnavigator/**` | Lista, Ny analys, bolagets arbetsyta |
| `apps/web/src/components/impact/*` | Chips, AI-banner, slutanalysvy, bolagskortets sektion |
| `backend/pocketbase-schema/scripts/import-sustainability-dump.mjs` (+ `lib/`, test) | Import av den gamla appens dump |

## 3. Flödet i modulen

1. **Ny analys** (`/impactnavigator/ny`): välj bolagskort eller skapa bolag,
   skriv bolagets resa, ansvarig. Version 1 skapas som "väntar på
   väsentlighetsanalys".
2. **Underlag**: ladda upp idébeskrivning och övriga dokument (PDF, Word,
   PowerPoint, Excel, text). Texten extraheras och personnummer-saneras.
3. **Väsentlighetsanalys** (AI-steg 1) → **granskning**: personalen sätter
   Väsentlig / Osäker / Ej väsentlig per aspekt och bekräftar
   (`sustainability_materiality_overrides`).
4. **Pröva underlaget** (AI-steg 2): kompletteringsfrågor (krävs /
   rekommenderas) → bolaget svarar (eller "uppgiften finns inte") → pröva
   igen eller gå vidare.
5. **Slutanalys** (AI-steg 3): startas av en människa; visas som dashboard
   med disclaimer.
6. **Uppdatering**: beskriv vad som hänt + nya dokument → ny version med
   uppdaterad slutanalys och "vad som ändrats" (AI-steg 4).
7. Bolagskortet (Utveckling & IRL) visar läget och länkar hit; allt loggas i
   `agent_actions` och syns i Bolagsnytt/`/aktivitet`.

## 4. Import av dumpen

```bash
sha256sum -c SHA256SUMS.txt
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --dry-run
PB_URL=https://pb-staging.app.movexum.se PB_SU_EMAIL=… PB_SU_PASSWORD=… \
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --tenant movexum --dry-run
PB_URL=… PB_SU_EMAIL=… PB_SU_PASSWORD=… \
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --tenant movexum [--fallback-user e-post]
```

- Kräver migration 1700000206 (kontrolleras innan något skrivs).
- Källans fem användare måste finnas i `users` (matchas på e-post); annars
  avbryts importen och maskerade adresser listas. `--fallback-user`
  tillskriver deras poster en befintlig användare.
- Bolag matchas på namn; befintliga bolag får bara `sustainability_*`-fälten.
- Loggen innehåller antal och bolagsnamn — aldrig e-post eller anteckningstext.
  Dumpen är kunddata: lagra den aldrig i repot, radera efter import.
- Importerade analyser visas i modulen precis som nya; deras `model_name`
  (`gpt-5.6-*`) visar att de kom från den gamla appen.

## 5. Regelefterlevnad

- **EU-suveränitet (§ 10.2):** modulen kör Mistral (`mistral-large-latest` →
  `mistral-medium-latest` vid 429/5xx). Ingen OpenAI-nyckel, inget
  US-anrop. De historiska analyserna bär sin OpenAI-provenans i `model_name`.
- **Riskklass (EU AI Act art. 11): begränsad** — beslutsstöd om bolag, inte
  individer; människan startar varje AI-steg, bekräftar väsentligheten och
  startar slutanalysen; ingen autopublicering. Banner § 9.7 på alla ytor;
  disclaimer i slutanalysen.
- **GDPR § 5:** bolagsdata. Fritext (bolagets resa, svar, uppdateringar,
  anteckningar, dokumenttext) personnummer-saneras på skrivvägen; UI:t
  uppmanar att inte skriva personuppgifter. `sustainability_documents` och
  `sustainability_ai_jobs` denylistade för AI-chatten. `cascadeDelete`
  tenant → startup → analys. Ingen DPIA ännu — skriv en under `docs/privacy/`
  före produktion om dokument med personuppgifter väntas.
- **RLS (§ 21.3):** staff/observer läser; Movexum-personal skriver; create
  pinnad till tenant + skapare. Bolagsmedlemmar har ingen yta.
- **Kostnad:** tokens loggas i `ai_usage_events` (surface `suggestions`) och
  räknas mot månadstaket (§ 9.6), som prövas före varje steg.
- **Verifiering:** `yarn test`, `yarn typecheck`, `yarn lint` gröna.
  Migrationerna har **inte** körts mot en PocketBase-instans i byggmiljön
  (binären kunde inte köras där) — kör på staging och låt
  `verify-baseline.mjs` fälla deployen om något avviker.
