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

## Åtgärd på servern (kvarstår)

SSH:a till UpCloud-hosten och kontrollera, för staging och produktion:

1. **Pekar `COOLIFY_APP_UUID_STAGING`/`_PRODUCTION` på rätt resurs?** Öppna
   Coolify → resursen vars UUID står i GitHub-secreten. Det MÅSTE vara
   docker-compose-stacken med `pocketbase`-tjänsten (infra/coolify.yml),
   inte web-appen. Nästa körning loggar resursnamnet ("Bygget … gäller
   resursen: …") — stämmer det inte: uppdatera secreten.
2. **Återskapas PB-containern?**
   `docker ps --format '{{.Names}}\t{{.CreatedAt}}' | grep pocketbase` —
   CreatedAt ska vara från senaste bygget. Är den gammal trots "finished":
   kontrollera i Coolify att compose-appen inte har pocketbase-tjänsten
   exkluderad, och trigga en redeploy med force.
3. **Finns hookarna i imagen?**
   `docker exec moveum-pocketbase ls /pb/pb_hooks` — ska lista
   `tenant_guard.pb.js` m.fl. ur repots `backend/pocketbase-schema/hooks/`.
4. **Startar PB utan migrationsfel?**
   `docker logs moveum-pocketbase --tail 100` — ett "Failed to apply
   migration …" vid start betyder att containern aldrig kommer upp på den
   nya imagen.
5. När PB-containern kör rätt image: kör om "Deploy to Coolify Staging"
   (och dispatcha produktionsdeployen) — verify-baseline ska då ge
   "✓ tenant-vakt aktiv".

**Separat observation (eget ärende):** en HELT FÄRSK installation (tom
pb_data) faller på migration `1700000051_create_mission_comments.js`
("The relation collection doesn't exist") — fältet refererar en kollektion
som skapas i en senare migration. Påverkar inte instanser med data, men
blockerar disaster recovery från noll; kräver en egen fix (migrationer är
oföränderliga — felet måste lösas utan att redigera applicerade filer).

## Lärdomar

- Merga aldrig en PR med rött typecheck till `staging` — deployen är samma
  grind och blockeras tills felet rättats (ISO 27001 A.8.32).
- En "readiness-probe" mot PB bevisar inte att den NYA containern kör —
  bara att NÅGON container svarar. Verifiering som gäller nytt innehåll
  (hooks, migrationer) måste vänta på att bygget faktiskt blivit klart.
