# Incident 2026-11-25 — staging har inte deployats sedan 2026-11-19

**Status:** workflow-delen åtgärdad i repot (typfel, väntan på Coolify-bygget,
serialisering, deadlock-fix, produktionsflödet). **Kvarstående serveråtgärd:**
PB-containrarna på BÅDE staging och produktion kör gamla images — se
"Grundorsak 4" + "Åtgärd på servern" nedan. Pipelinen fortsätter (korrekt)
att falla på tenant-vakt-provet tills det är åtgärdat.

## Tidslinje (UTC, från GitHub Actions-loggarna)

| Tid | Körning | Commit | Utfall |
| --- | --- | --- | --- |
| 11-19 12:49 | #44527477117 | 90abe6e9 | ✅ Sista gröna staging-deployen. |
| 11-19 13:16 | #44531817748 | 12cf8aa3 (PR #511) | ❌ `verify-baseline` i deploy-steget: live-reglerna bar flyttlåsen (§ 21.8) som den PARALLELLA körningen nedan just skrivit — commiten 12cf8aa3 saknade dem i repot. |
| 11-19 13:17 | #44532022693 | 15bef190 (PR #510) | ❌ `verify-baseline` i sync-jobbet: "tenant-vakten (hooks/tenant_guard.pb.js) är inte aktiv" — verifieringen kördes mot den GAMLA PB-containern medan Coolify fortfarande byggde om stacken med hookarna. |
| 11-19 14:01 | #44539385364 | 290ab9b7 (PR #509) | ❌ `yarn typecheck`: `step-detail.test.ts(74,69) TS2353` — testet skickar `error` som saknas i `summarizeStepResult`-signaturen. |
| 11-25 07:58 | #45572376939 | dd683018 (PR #514) | ❌ Samma typfel. `sync-pocketbase` + `deploy` skippades. |

## Root cause — tre skilda fel

1. **Typfel som blockerade allt sedan PR #509.**
   `apps/web/src/lib/ai/step-detail.test.ts` provar
   `summarizeStepResult('query_collection', { ok: false, error: 'x' })`, men
   funktionens inline-parametertyp saknade `error` — trots att den verkliga
   anroparens `ToolResult` (`lib/ai/tools.ts`) har `error?: string`. PR:en
   mergades med rött typecheck; varje senare staging-push föll på samma rad.

2. **Race mot Coolify-bygget.** `coolify-deploy.sh` KÖAR bara en deploy
   (Coolify svarar direkt och bygger i bakgrunden). `sync-pocketbase`-jobbet
   väntade sedan bara på PB-*readiness* — men den gamla PB-containern svarar
   200 tills den nya ersätter den, så `setup-via-api` + `verify-baseline`
   körde mot den gamla containern UTAN `tenant_guard.pb.js` → hård fail,
   trots att bygget som skulle fixa saken redan var på väg.

3. **Parallella deployer racear varandra.** Tre merges inom en timme gav tre
   samtidiga körningar; körningen för den äldre commiten verifierade reglerna
   medan en nyare körnings `setup-via-api` skrev flyttlåsen live →
   "förväntat utan lås, fick med lås".

4. **PB-containrarna kör gamla images (HUVUDFYND, serveråtgärd krävs).**
   Efter fix 1–3 väntade run 45592088922 korrekt in Coolify-bygget
   (status `finished` efter ~5 min) — och tenant-vakt-provet föll ÄNDÅ.
   Belägg:
   - Hooken är **verifierad fungerande** mot PocketBase 0.23.4 lokalt med
     repots `hooksDir` (cross-tenant-create → 403, egen tenant → 200).
   - `setup-via-api` varnar i varje sync sedan minst 11-19:
     *"notifications.kind: … migration 1700000186 måste köras av
     PocketBase-containern"* — en migration från **oktober**. Staging-PB:n
     har alltså inte applicerat nya migrationer (och därmed inte fått nya
     hooks) på över en månad, trots "lyckade" stack-redeploys med
     `force=true`.
   - Tenant-vakt-provet har **aldrig** varit grönt mot staging: sista gröna
     deployen (90abe6e9, 11-19 12:49) innehöll inte provet
     (`verifyTenantGuardHook` kom med 98f3d43f).
   - Produktionsstacken byggdes senast om **2026-09-29** (sista
     sync-pocketbase-production-körningen); produktions-PB:ns image saknar
     därmed garanterat allt från oktober/november (flyttlås-migrationerna,
     rate-limit 1700000218, tenant-vakten).
   Trolig orsak: Coolify-resursen som `COOLIFY_APP_UUID_STAGING` pekar på
   förnyar inte pocketbase-tjänstens container (fel resurs — t.ex. bara
   web-appen — eller så återskapas inte containern trots ombyggd image).
   Kan inte avgöras från repot; se "Åtgärd på servern".

   **BEKRÄFTAT (run 45599886104, via bygglogg-utdraget):** Coolify-bygget
   kör `docker build --no-cache -f /artifacts/…` mot en Dockerfile med
   `ARG "POCKETBASE_SUPERUSER_PASSWORD"` och `ARG "POCKETBASE_ENCRYPTION_KEY"`
   på raderna 11/15, 50/54 och 97/101 — **den filen finns inte i repot**
   (varken `backend/pocketbase-schema/Dockerfile` eller `apps/web/Dockerfile`
   har de ARG:en). Coolify-resursen är alltså en LEGACY-app med en egen,
   i Coolify sparad Dockerfile från det tidiga enkelcontainer-upplägget
   (som dessutom bakar in PB-lösenordet som build-ARG — flaggas av
   BuildKit:s SecretsUsedInArgOrEnv). Den bygger ALDRIG repots
   `infra/coolify.yml`-stack → PB-containern får aldrig repots
   migrationer/hooks, oavsett hur många "lyckade" rebuilds som körs.

## Åtgärder (i repot)

- **Typfelet:** `summarizeStepResult`-parametern i
  `apps/web/src/lib/ai/step-detail.ts` har nu `error?: string` (speglar
  `ToolResult`). `yarn typecheck` grön.
- **`COOLIFY_WAIT=true` i `coolify-deploy.sh`:** efter 2xx plockas
  `deployment_uuid` ur svaret och `/api/v1/deployments/<uuid>` pollas tills
  bygget är `finished` (failed/cancelled eller timeout → exit 1 med
  actionable fel — hellre stoppa än verifiera mot den gamla containern).
  Opt-in; utan uuid/bas-URL varnas det och körningen fortsätter som förut.
  Aktiverad i alla fyra workflows där schema-sync/bootstrap/verify följer
  efter triggern. Testad i `.github/scripts/coolify-deploy.test.mjs`.
- **Concurrency-grupper:** `coolify-staging` (deploy.yml +
  sync-pocketbase.yml) och `coolify-production` (deploy-production.yml +
  sync-pocketbase-production.yml), `cancel-in-progress: false` — deployer
  mot samma miljö serialiseras, en manuell sync kan inte racea en deploy.
  **Följdfix (samma dag, run 45590771368):** en anropad reusable workflow
  med SAMMA workflow-nivå-grupp som anroparen deadlockar — GitHub köar den
  bakom anroparen som väntar på den, sync-jobben skapas aldrig och körningen
  faller. Sync-workflowsen delar därför gruppen BARA vid fristående
  `workflow_dispatch` (`github.workflow` = eget namn); vid `workflow_call`
  används en unik grupp per run (anroparens grupp serialiserar redan).
- **Produktionsflödet:** `deploy-production.yml` anropade ALDRIG
  produktions-synken — PB-stacken byggdes bara om när någon mindes att
  dispatcha "Sync PocketBase schema (production)" manuellt (senast 09-29).
  Nu: build-image → typecheck → `sync-pocketbase-production` (stack-rebuild
  med `COOLIFY_WAIT` → setup-via-api → verify-baseline) vid VARJE
  produktionsdeploy; det redundanta deploy-jobbet (duplicerad bootstrap +
  verify) är borttaget.
- **Diagnosbarhet:** `coolify-deploy.sh` loggar vilken RESURS bygget gäller
  (ur deployment-statusens `application_name`) så en felpekad UUID syns i
  loggen; tenant-vakt-felet i `verify-baseline.mjs` bär nu färskhetsbevis
  (är `notifications.kind` fortfarande select är imagen byggd före migration
  1700000186) + serverrunbooken nedan.

## Åtgärd på servern (kvarstår — ENDA kvarvarande steget)

Grundorsaken är bekräftad (se ovan): Coolify-resursen bakom
`COOLIFY_APP_UUID_STAGING` bygger en legacy-Dockerfile sparad i Coolify,
inte repots compose-stack. Fixen görs i Coolify-UI:t (~10 min per miljö):

1. **Skapa/peka om till compose-stacken.** Coolify → projektet → skapa en
   resurs av typen **Docker Compose** med GitHub-repot `Mov3xum/platform`,
   gren `staging` (produktion: samma repo, taggen/grenen för produktion)
   och **Docker Compose Location** `infra/coolify.yml`. Sätt env-variablerna
   från den gamla resursen (POCKETBASE_ENCRYPTION_KEY,
   APP_ADMIN_INITIAL_PASSWORD, MOVEXUM_* m.fl.) och se till att
   `pb_data`-volymen återanvänds/migreras så datat följer med.
2. **Uppdatera GitHub-secreten** `COOLIFY_APP_UUID_STAGING`
   (resp. `_PRODUCTION`) till den NYA resursens UUID.
3. **Stäng av/ta bort legacy-resursen** (den med egen Dockerfile och
   `ARG POCKETBASE_SUPERUSER_PASSWORD` — lösenord ska aldrig vara
   build-ARG, A.8.24).
4. Kör om "Deploy to Coolify Staging" (resp. dispatcha produktionsdeployen
   från `staging`). Bygglogg-utdraget i Actions ska nu visa
   `Container moveum-pocketbase Recreated`, och verify-baseline ska ge
   "✓ tenant-vakt aktiv".

Kontroller på hosten om något ändå strular:

1. `docker ps --format '{{.Names}}\t{{.CreatedAt}}' | grep pocketbase` —
   CreatedAt ska vara från senaste bygget.
2. `docker exec moveum-pocketbase ls /pb/pb_hooks` — ska lista
   `tenant_guard.pb.js` m.fl. ur repots `backend/pocketbase-schema/hooks/`.
3. `docker logs moveum-pocketbase --tail 100` — inget "Failed to apply
   migration …" vid start.

**Separat observation (eget ärende):** en HELT FÄRSK installation (tom
pb_data) faller på migration `1700000051_create_mission_comments.js`
("The relation collection doesn't exist") — fältet refererar en kollektion
som skapas i en senare migration. Påverkar inte instanser med data, men
blockerar disaster recovery från noll; kräver en egen fix (migrationer är
oföränderliga — felet måste lösas utan att redigera applicerade filer).

## Produktion 2026-11-25 — bygget blev aldrig klart (run 45606848091)

Första produktionsdeployen efter att `deploy-production.yml` börjat bygga om
stacken (commit 6e75ab29, 11:41 UTC):

- Coolify köade bygget `bvedwjtf0roxc5c1iq0qmjya` och rapporterade
  `in_progress` i 30 minuter. Samma bygge tar ~6 minuter på staging.
- 11:57:54–12:01:43 UTC svarade Coolifys status-API **HTTP 500** på 16
  kontroller i rad (~4 min), därefter `in_progress` igen till timeouten
  (1800 s). Workflowen avbröt före `setup-via-api` och `verify-baseline`.
- **Inte fastställt:** om bygget hängde sig när Coolify svarade 500
  (omstart eller resursbrist på servern medan imagen byggdes med
  `--no-cache`) eller bara var långsamt. Det avgörs i Coolify →
  Deployments och med `docker logs coolify`, `free -m`, `dmesg` på servern.
- Följd: produktions-PB är varken ombyggd, regel-synkad eller verifierad mot
  `main`; ett bygge som står kvar som In progress blockerar nästa deploy
  tills det avbryts.

Åtgärd i repot: `coolify-deploy.sh` skriver vid timeout/failed ut slutet av
byggloggen (dolda poster utelämnas, lösenords-/nyckelvärden maskas), hur
länge loggen stått still och om Coolify svarade 5xx under bygget.
"Diagnose Coolify resources" listar pågående deployer. Serveråtgärden är
densamma som för staging (compose-resursen ovan): då byggs bara PB-imagen
på servern och web hämtas färdigbyggd från GHCR.

## Lärdomar

- Merga aldrig en PR med rött typecheck till `staging` — deployen är samma
  grind och blockeras tills felet rättats (ISO 27001 A.8.32).
- En "readiness-probe" mot PB bevisar inte att den NYA containern kör —
  bara att NÅGON container svarar. Verifiering som gäller nytt innehåll
  (hooks, migrationer) måste vänta på att bygget faktiskt blivit klart.
