# Incident 2026-11-25 — staging har inte deployats sedan 2026-11-19

**Status:** åtgärdat i repot (typfel + två workflow-robusthetsfixar).
Ingen serveråtgärd krävs — Coolify-instansen var frisk hela tiden.

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

## Lärdomar

- Merga aldrig en PR med rött typecheck till `staging` — deployen är samma
  grind och blockeras tills felet rättats (ISO 27001 A.8.32).
- En "readiness-probe" mot PB bevisar inte att den NYA containern kör —
  bara att NÅGON container svarar. Verifiering som gäller nytt innehåll
  (hooks, migrationer) måste vänta på att bygget faktiskt blivit klart.
