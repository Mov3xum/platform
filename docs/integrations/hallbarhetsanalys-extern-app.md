# Hållbarhetsanalysen (extern app) — tabeller i Movexums PocketBase

> Appen på `https://inkubator-kohl.vercel.app/companies` (internt kallad
> "Sales Navigator") fortsätter att köra fristående på sin egen domän, men
> dess databas flyttar från Neon/Postgres till Movexums PocketBase.
> Bindande regler: CLAUDE.md § 56. Detta dokument är runbooken.

## 1. Vad appen är (ur dumpen 2026-10-14)

Dumpen (`movexum.dump`, pg_dump 18.6, 9 tabeller, 167 rader) visar att appen
är en **AI-stödd hållbarhetsanalys per bolag**: väsentlighetsanalys av
ESG-aspekter (`OWN-ENV-01`, `OWN-SOC-01`, `OWN-GOV-01`, `OWN-GOV-02`),
informationstillräcklighet med kompletteringsfrågor, en slutanalys
("dashboard": risker, möjligheter, greenwashing-risker, diskussionsfrågor,
IMPACT_DRIVEN / SUSTAINABILITY_DRIVEN / RISK_EXPOSED) och versionerade
uppdateringsanalyser. Modellen i källan är **OpenAI `gpt-5.6`** (US) — se § 5.

| Källa (Postgres) | Rader | Hos oss | Anm. |
|---|---|---|---|
| `User` | 5 | `users` (FINNS) | Matchas på e-post. `passwordHash`/`clerkUserId` importeras aldrig. Konton skapas av admin i Inställningar → Användare. |
| `Company` | 9 | `startups` (FINNS) | `name`→`name`, `phase`→`phase` (mappad, nedan), `industry`→`industri`. **Tillagt:** `sustainability_journey_text`, `sustainability_status`, `sustainability_assigned_to`. |
| `Note` | 5 | `notes` (FINNS) | `body` klartext → escapad `<p>`-HTML, `confidential=false`. |
| `Assessment` | 22 | `sustainability_assessments` (NY) | Unik `(startup, version)`; `previous_assessment` self-relation. |
| `GapQuestion` | 31 | `sustainability_gap_questions` (NY) | |
| `MaterialityOverride` | 4 | `sustainability_materiality_overrides` (NY) | |
| `UpdateEvent` | 13 | `sustainability_update_events` (NY) | |
| `Document` | 20 | `sustainability_documents` (NY) | `file` = riktigt PB-filfält (protected). Originalfilerna (Vercel Blob) ingår **inte** i dumpen — `storage_path` är bara referens. `openaiFileId` importeras inte. |
| `AIJob` | 58 | `sustainability_ai_jobs` (NY) | Audit per modellkörning (art. 12). |

Fasmappning `CompanyPhase` → `startups.phase`: SCREENING→`lead`,
BOOST_CHAMBER→`boost_chamber`, INKUBATOR→`incubation`,
ACCELERATOR→`acceleration`, ALUMNI→`alumni`, EXIT→`alumni`. Alla
enum-värden i övrigt är källans värden i gemener (källa av sanning:
`backend/pocketbase-schema/scripts/lib/sustainability-import.mjs`, speglad
i migration 1700000206 och låst av enhetstest).

Varje ny kollektion bär `external_id` (källans cuid, unikt per tenant) så
importen är idempotent, och `source_created_at` (källans tidsstämpel —
`created` är autodate och kan inte sättas vid import).

## 2. Schema

Migration `backend/pocketbase-schema/migrations/1700000206_create_sustainability_analysis.js`
(speglad i `scripts/setup-via-api.mjs`, asserterad i `scripts/verify-baseline.mjs`).

RLS (§ 21.3): list/view **staff/observer** i tenanten (appen är ett
personalverktyg — källan har ingen bolagsmedlemsroll); create pinnar
`tenant` + skapare (`created_by`/`uploaded_by`) eller bara tenant där källan
saknar skapare (frågor, AI-körningar); update Movexum-personal; delete
ledningen. `sustainability_documents` och `sustainability_ai_jobs` är
denylistade för chattens `query_collection` (fritext ur tredjepartsmaterial);
analyser, frågor, justeringar och uppdateringar är läsbara under RLS +
fältmaskning.

## 3. Så ansluter den fristående appen

Appen behåller sin domän och sin Clerk-inloggning, men all data läses och
skrivs mot PocketBase (`https://pb-app.movexum.se` i produktion,
`https://pb-staging.app.movexum.se` på staging — se
`backend/pocketbase-schema/README.md`).

1. **Serverhemlighet på Vercel** (aldrig i klienten): `MOVEXUM_PB_URL`,
   `MOVEXUM_PB_SERVICE_EMAIL`, `MOVEXUM_PB_SERVICE_PASSWORD` — en egen
   `_superusers`-rad för appen (skapa i PB-admin `/_/`), inte Hampus konto.
2. **Agera som den inloggade — inte som superuser.** Efter Clerk-inloggning
   slår servern upp `users` på e-post (`email = {:e} && tenant = {:t}`) och
   hämtar en impersonationstoken:
   ```ts
   const admin = new PocketBase(process.env.MOVEXUM_PB_URL);
   await admin.collection('_superusers').authWithPassword(email, password);
   const [user] = (await admin.collection('users').getList(1, 1, {
     filter: admin.filter('email = {:e}', { e: clerkEmail.toLowerCase() })
   })).items;
   const asUser = await admin.collection('users').impersonate(user.id, 3600);
   // asUser är en PocketBase-klient med användarens token → RLS gäller.
   ```
   Saknas kontot: visa "be Movexum lägga upp ditt konto" — appen skapar
   inga användare. Rollerna i källan (ADMIN/INFLOW/COACH/BUSINESS_DEVELOPER)
   motsvarar våra `admin`/`incubator_lead`/`coach`/`mentor`; läs
   `user.roles` och gör rollgrindar i appen på dem (RLS är gränsen).
3. **Skriv alltid `tenant`** (`= user.tenant`) och skaparfältet
   (`created_by`/`uploaded_by` = `user.id`) — createRules kräver det.
4. **Bolag** = `startups`. Appens "Company"-lista är
   `startups` i tenanten (filtrera på `sustainability_status != ''` för de
   som har en analys). Nytt bolag: skapa `startups`-rad med `name`, `phase`,
   `status: 'active'`, `industri`, `sustainability_journey_text`,
   `sustainability_status: 'draft'`.
5. **Dokument**: multipart-POST till `sustainability_documents` med fältet
   `file`; nedladdning kräver filtoken (`pb.files.getToken()`) eftersom
   fältet är `protected`. Textutdraget skrivs till `extracted_text`
   (personnummer-sanerat, § 15.6-regexen).
6. **Anteckningar** = `notes` (`startup`, `author = user.id`, `body` som HTML,
   `confidential: false`).

Ingen separat API-nyckel eller webhook behövs; PocketBase REST är gränsen.
Lägg appens domän i PB:s CORS-inställning om klienten ska tala direkt med PB
(rekommendation: bara servern talar med PB).

## 4. Import av dumpen

```bash
# 1. Verifiera filen
sha256sum -c SHA256SUMS.txt

# 2. Dry-run utan databas (tolkar arkivet, visar planen)
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --dry-run

# 3. Dry-run mot PB (matchar användare/bolag, skriver inget)
PB_URL=https://pb-staging.app.movexum.se PB_SU_EMAIL=… PB_SU_PASSWORD=… \
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --tenant movexum --dry-run

# 4. Skarp import (kör om vid behov — idempotent)
PB_URL=… PB_SU_EMAIL=… PB_SU_PASSWORD=… \
node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs --dump ./movexum.dump --tenant movexum [--fallback-user e-post]
```

- Kräver migration 1700000206 (kontrolleras innan något skrivs).
- Källans fem användare måste finnas i `users` (matchas på e-post); annars
  avbryts importen och de maskerade adresserna listas. `--fallback-user`
  tillskriver deras poster en befintlig användare i stället.
- Bolag matchas på namn (skiftläges- och whitespace-okänsligt). Befintliga
  bolag får bara `sustainability_*`-fälten satta — namn/fas/bransch rörs inte.
- Loggen innehåller antal och bolagsnamn; aldrig e-post eller
  anteckningstext. Dumpen innehåller kunddata (LAS_MIG.txt) — lagra den
  aldrig i repot och radera den efter import.

## 5. Regelefterlevnad och öppna beslut

- **AI-leverantör (§ 10.2, PR-checklistan p. 3):** källan körde
  OpenAI `gpt-5.6` (US). Att LAGRA redan producerade analyser är
  oproblematiskt; att den fristående appen FORTSÄTTER köra nya analyser via
  OpenAI mot bolagsdata i vår databas är ett avsteg från EU-suveräniteten
  som maintainer måste godkänna uttryckligen — alternativet är att byta
  appens modellanrop till Mistral (`model_name` bär provenansen per
  analys/körning oavsett).
- **Riskklass (EU AI Act art. 11): begränsad** — beslutsstöd om bolag (inte
  individer), människa granskar varje analys i appen, ingen autopublicering.
  Transparensbanner (§ 9.7) ska visas i appen.
- **GDPR § 5:** analyser är bolagsdata. Fritext (bolagets resa,
  anteckningar, frågor/svar, dokumenttext, narrativ) personnummer-saneras på
  importvägen; appen ska göra detsamma på sin skrivväg. `extracted_text`
  och `output` är denylistade för AI-chatten. `cascadeDelete` tenant →
  startup → analys → frågor/justeringar (art. 17). Ingen DPIA finns för
  appen — skriv en under `docs/privacy/` innan produktion om dokument med
  personuppgifter väntas laddas upp.
- **Inte byggt (medvetet):** länk/sektion på bolagskortet, modul i railen,
  SSO mellan plattformen och appen, filåterställning från Vercel Blob,
  chatt-verktyg mot analyserna. Nästa steg när behovet visar sig.
- **Verifiering:** migrationens syntax, enhetstester (parser, mappning,
  enum-paritet mot migrationen) och `yarn test`/`yarn typecheck` är gröna.
  Migrationen har **inte** körts mot en PocketBase-instans i byggmiljön
  (binären kunde inte köras där) — kör den på staging och låt
  `verify-baseline.mjs` fälla deployen om något avviker.
