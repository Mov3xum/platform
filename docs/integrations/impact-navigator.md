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

Modulen är en **portering av den gamla appens GitHub-repo** (Next.js +
Prisma + OpenAI) till plattformens stack. Samma sidor, samma svenska
promptar, samma fem impactnivåer, samma granskningssemantik — men PocketBase
i stället för Prisma, Mistral i stället för OpenAI, Movexums design-tokens,
RLS § 21 och audit i `agent_actions`.

| Fil | Syfte | Motsvarighet i originalet |
|---|---|---|
| `backend/pocketbase-schema/migrations/1700000206_create_sustainability_analysis.js` | Schema (startups-fält + sex kollektioner), RLS | `prisma/schema.prisma` |
| `backend/pocketbase-schema/migrations/1700000207_backfill_enabled_modules_impactnavigator.js` | Modulen i befintliga användares sidmeny (§ 36.3) | — |
| `packages/shared/src/impact-navigator.ts` (+ `.test.ts`) | REN domän: vokabulär, fem impactnivåer + kriterier, etiketter, visningskoder (`ENV-01`), ESRS-referensområden, typer = originalets Zod-scheman, tolerant normalisering av AI-svar, väsentlighetsgranskning (`applyImpactMaterialityReview`, `createImpactCustomAspect`), statusmaskin, gap-status | `lib/ai/schemas.ts`, `lib/sustainability/*` |
| `packages/shared/src/impact-prompts.ts` (+ `.test.ts`) | Originalets systempromptar ordagrant (gemensam + per steg + frågeregler) + OUTPUTFORMAT-block som ersätter Zod structured outputs. `IMPACT_PROMPT_VERSION = 2026-08-10-v1+mistral` | `lib/ai/prompts.ts` |
| `packages/shared/src/impact-inputs.ts` (+ `.test.ts`) | Underlagsbyggarna per steg (state-plus-delta, 60 000 tecken/dokument, dedupe av redan känd text) | `lib/ai/inputs.ts` |
| `apps/web/src/lib/impact/data.ts` | Enda läsvägen (användartoken → RLS) | Prisma-anrop i sidorna |
| `apps/web/src/lib/ai/impact-analysis.ts` | Fyra Mistral-steg med `response_format: json_object`; normalisering → aldrig ett ovaliderat svar i databasen | `lib/ai/openai.ts` |
| `apps/web/src/lib/actions/impact.ts` | Server actions: skapa bolag, väsentlighet, godkänn granskning (+ tillräcklighet direkt), pröva underlag igen, slutanalys med gap-svar, uppdatering (ny version), bolagsuppgifter, anteckning, radera dokument/analys — RBAC, audit, budget | `lib/actions/company.ts`, `lib/actions/assessment.ts` |
| `apps/web/src/lib/impact/report-pdf.ts` + `app/api/impactnavigator/[startupId]/rapport/route.ts` | Impactrapporten som PDF (pdf-lib, Sora/Nunito, Movexum-brand; originalets avsnittsordning) | `lib/pdf/impactReport.ts`, `app/api/export` |
| `apps/web/src/app/api/impactnavigator/documents/route.ts` | Uppladdning + textextraktion (route handler, § 18.2); tar `assessment_id`/`gap_question_id` | `lib/documents/uploads.ts` |
| `apps/web/src/app/api/impactnavigator/documents/[id]/file/route.ts` | Tenant-scopad filproxy (protected file) | Vercel Blob |
| `apps/web/src/app/impactnavigator/page.tsx` | Alla bolag: sök, fas- och nivåfilter, kortrutnät, Öppna, Radera | `app/companies/page.tsx` |
| `apps/web/src/app/impactnavigator/jamfor/page.tsx` | Sorterbar jämförelsetabell | `app/companies/[id]/compare` |
| `apps/web/src/app/impactnavigator/ny/**` | Intro (fyra steg) + "Steg 1 av 4 — Berätta om bolaget" (idébeskrivning obligatorisk) | `app/companies/new` |
| `apps/web/src/app/impactnavigator/[startupId]/{vasentlighet,analys,dashboard,dokument,historik,anteckningar,installningar}` | Bolagets sidor (originalets sidomeny som flikar); `lib/impact/shell.tsx` är skalet, `lib/impact/tabs.ts` sökvägarna | `app/companies/[id]/*` |
| `apps/web/src/components/impact/*` | Chips/badges, `Stepper`, `AiSubmitButton` (överlagring, 3 steg, timeout), `FileDropInput`, `MaterialityReviewFields`, `GapResponseFields`, `DashboardView`, `CompanyCreationIntro`, bolagskortets sektion | `src/components/*` |
| `backend/pocketbase-schema/scripts/import-sustainability-dump.mjs` (+ `lib/`, test) | Import av den gamla appens dump | — |

## 3. Flödet i modulen (= originalets fyra steg)

1. **Skapa nytt bolag** (`/impactnavigator/ny`): namn, Movexumfas, bransch,
   **obligatorisk idébeskrivning** + övrigt underlag, bolagets
   hållbarhetsambitioner. Plattformstillägg: analysen kan startas på ett
   befintligt bolagskort (namn/fas/bransch följer kortet). Submit skapar
   bolaget + version 1, laddar upp filerna (route handler) och kör
   **väsentlighetsanalysen** (AI-steg 1) direkt → `materiality_review`.
   Misslyckas AI-steget stannar versionen i `materiality_pending` och
   "Försök igen" finns på väsentlighetssidan.
2. **Väsentliga områden** (`/vasentlighet`): aspekterna per kategori med
   visningskod (`ENV-01`), styrka 1–5, drivkrafter, konfidens, evidens;
   personalen sätter Väsentlig / Osäker / Ej väsentlig per aspekt,
   lyfter övervägda-men-ej-valda aspekter, lägger eget område och
   sammanfattande kommentar. "Godkänn" sparar justeringarna
   (`sustainability_materiality_overrides`), skriver om väsentligheten och
   kör **tillräcklighetsprövningen** (AI-steg 2) direkt → `needs_more_info`
   med kompletteringsfrågor (krävs / rekommenderas).
3. **Informationsgap** (`/analys`): svara per fråga (text, bilaga eller
   "uppgiften finns inte"), ladda upp mer underlag och pröva igen
   (`info_pending` → steg 2 på nytt), eller **kör slutanalysen** (AI-steg 3)
   → `complete`. Ett misslyckat steg lämnar versionen i föregående läge.
4. **Dashboard** (`/dashboard`, `?version=`): sammanfattning,
   övergripande potential + områden, impactnivå (fem nivåer), affärsmodell,
   prioriterat arbete, risker, möjligheter, trovärdig kommunikation, frågor
   till nästa samtal, antaganden/begränsningar, disclaimer. **Uppdatera
   bolag**: vad har hänt + nya dokument → ny version (`update`) med
   uppdaterad dashboard och delta (AI-steg 4); misslyckas den markeras
   versionen `failed` och bolaget går tillbaka till analyserat.
   **Exportera rapport** → PDF.
5. **Dokument / Historik / Anteckningar / Bolagsuppgifter**: alla versioner
   med delta och länk till versionens dashboard, AI-körningarna (art. 12),
   interna anteckningar (`notes`), ändra namn/fas/bransch/resa/ansvarig,
   **radera analysen** (ledning; bolagskortet finns kvar).
6. Bolagskortet (Utveckling & IRL) visar läget och länkar hit; allt loggas
   i `agent_actions` och syns i Bolagsnytt/`/aktivitet`.

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
  `mistral-medium-latest` vid 429/5xx) med originalets promptar och
  `response_format: json_object`; svaret normaliseras fält för fält
  (`normalizeImpact*`) eftersom Mistral inte har Zod-bundna structured
  outputs. Ingen OpenAI-nyckel, inget US-anrop. De historiska analyserna bär
  sin OpenAI-provenans i `model_name`; nya bär `prompt_version =
  2026-08-10-v1+mistral`.
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
