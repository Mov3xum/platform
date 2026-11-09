# Movexum OS — implementationsplan utan duplicerad logik

> Följer analysen i `movexum-os-analys-verksamhetsdag-2026-09.md`. Svarar på
> frågan: *hur bygger vi blocken § 4.1–4.9 utan att duplicera kod eller logik,
> med CLAUDE.md § 1–39 upprätthållet och säkert?* Principen är att **varje
> block är en ny adapter mot en befintlig motor** — inte en ny motor.

---

## 1. Fem befintliga motorer som bär allt nytt

| Motor | Var den finns idag | Vad den bär i planen |
| --- | --- | --- |
| **Delade skrivlagret** | `lib/core/write/*` — `writable-fields.ts` (rollpolicy, agent ⊆ människa), `validators.ts`, `helpers.ts` (`writeWithFallback`, `getRecordInTenant`), `audit.ts` (`logAgentAction`) | Mål, program, enrollments, allokering, projekt, partnernivåer — UI‑actions och chatt‑verktyg anropar **samma** funktion |
| **Regelmotorn** | `@platform/shared/procurement.ts` (`planProcurementFollowups`, `diffProcurementFollowups`, ankare/villkor/repeat) + `lib/procurements/followups.ts` (idempotent synk mot `tasks.rule_key`) | Gateway‑klockor, 8‑månadersregeln, partnerförnyelse, rekvisitionsdeadlines, personalonboarding‑påminnelser |
| **Formulärmotorn** | Startupkompassen: `compass_modules` (quiz/wizard/chat), `compass_responses`, samtycke, attribution, `lib/compass/lead-capture.ts`, `question-flow.ts`, AI‑sammanfattning | Kundnöjdhet, NPS, partnerenkät, medarbetarindex, BC‑ansökan, Team Canvas‑check |
| **Läs‑/aggregeringsmönstret** | `pb.server.ts` (`listAllForTenant`, `getOneForTenant`, `startupScopeFilter`), ren logik i `@platform/shared` med Node‑tester (`annual-wheel.ts`, `home.ts`), presentationsläge `/arshjul/presentation`, `Dashboard.tsx`‑primitiver, dokumentlagret `documents/templates.ts` | Målcockpit, programansvarig‑cockpit, kommunrapport, highlights |
| **Chatt‑integrationen** | `lib/ai/tools.ts` (`buildChatTools`, dispatch), `write-receipt.ts` (`DOMAIN_WRITE_TOOLS`), `guidance.ts` (`CHAT_WRITE_ACTIONS_GUIDANCE`), `chat-guide.ts`, `feed/agent-log.ts` | Varje nytt skrivverktyg = en rad i vardera fil, ingen egen dataväg |

Det som **inte** finns och måste byggas en gång, som delad infrastruktur:

1. **Generisk regelmotor** (`followup-rules.ts`) — dagens är hårdkodad till
   upphandlingens ankare/villkor.
2. **Metrikregister** (`lib/metrics/`) — idag räknas nyckeltal på fyra ställen
   (`lib/overview/aggregate.ts`, `lib/reporting/dataset.ts`,
   `lib/compass/store.ts` `getCompassDashboard`, `app/hem/page.tsx`).
3. **Enkätsyfte på kompassmodulen** (`purpose` + målobjekt) — idag antar
   motorn alltid "intag → lead".

---

## 2. Steg 0 — refaktorer som gör resten billigt (inga beteendeändringar)

### 2.1 Generalisera regelmotorn: `@platform/shared/followup-rules.ts`

Dagens `planProcurementFollowups` blandar tre saker: (a) den generiska
expansionen offset + repeat + idempotensnyckel + diff mot befintliga kort, och
(b/c) domänspecifika `anchorDate()` / `conditionHolds()`. Lyft ut (a) till en
ren, generisk planerare som tar en **domänadapter**:

```ts
// packages/shared/src/followup-rules.ts (ren, enhetstestad)
export interface FollowupRuleBase { id: string; anchor: string; condition: string;
  offset_days: number; repeat: 'once'|'monthly'|'quarterly'; task_title: string;
  task_kind: string; enabled: boolean }
export interface FollowupDomainAdapter<Rule extends FollowupRuleBase, Target> {
  /** Namnrymd i rule_key så domäner aldrig kolliderar: 'proc' | 'prog' | 'partner' | 'fund' | 'onb' */
  namespace: string;
  anchorDate(rule: Rule, target: Target): string | null;
  conditionHolds(rule: Rule, target: Target): boolean;
  ruleApplies(rule: Rule, target: Target): boolean;          // t.ex. applies_to='excellence'
  fillTitle(rule: Rule, target: Target): string;
  linkFields(target: Target): Record<string, string>;       // { procurement, procurement_calloff } | { program_enrollment, startup? }
}
export function planFollowups<R, T>(adapter, rules, targets, today): PlanResult
export function diffFollowups(plan, existing): Diff   // = dagens diffProcurementFollowups
```

`procurement.ts` behåller sina exporterade namn som **tunna omslag** över den
generiska planeraren med en `procurementAdapter`. Bevis på "ingen beteende‑
ändring": de befintliga testerna i `procurement.test.ts` körs oförändrade, plus
ett snapshot‑test som kör gamla och nya vägen på samma fixtur och kräver
identiskt resultat.

`lib/procurements/followups.ts` → `lib/followups/sync.ts`:
`syncFollowups(pb, actor, adapter, { rules, targets, linkKind, owner })`. Allt
som redan gäller (skapa/flytta/auto‑stäng, aldrig röra mänskligt stängda kort,
en sammanfattningsrad i `agent_actions`, `rule_key` som idempotens, fail‑soft
med tydligt migrationsfel) skrivs **en** gång. Upphandlingsmodulen anropar den
generiska med sin adapter.

**Schema:** `tasks.rule_key` finns redan med unikt partiellt index per tenant.
Namnrymden i nyckeln (`prog:<rule>:<enrollment>:<n>`) gör att inga migrationer
behövs för nyckeln själv; däremot behövs `tasks.link_kind += 'program' |
'partner' | 'funding_project'` + relationsfält (union på enumet, aldrig
ersätt listan — § 21.3‑läxan från 1700000049).

### 2.2 Metrikregister: `lib/metrics/registry.ts` + `@platform/shared/metrics.ts`

En indikator definieras **en gång** och konsumeras av målcockpit,
programansvarig‑cockpit, kommunrapport, `/hem`‑sifferraden och agenterna:

```ts
// @platform/shared/metrics.ts — ren logik, enhetstestad
export type MetricKey = 'startups_in_program' | 'alumni_count' | 'conv_bc_to_inc'
  | 'conv_inc_to_acc_8m' | 'conv_lead_to_bc' | 'excellence_share' | 'leads_count'
  | 'events_per_kommun' | 'partners_count' | 'inflow_sla_days' | 'women_share' | …;
export interface MetricDefinition { key; label; unit: 'count'|'pct'|'days'|'sek'; higherIsBetter;
  /** Hur värdet får visas: art. 9-aggregat kräver k-anonymitet */
  sensitivity: 'none' | 'aggregate_only' }
export function conversionFromPhaseHistory(rows, from, to, { withinMonths, cohortYear }): number | null
export function medianDaysInPhase(rows, phase): number | null
export function shareWithThreshold(numerator, denominator, k = 5): number | null // null under tröskel
```

```ts
// lib/metrics/registry.ts — IO, server-only
export const METRICS: Record<MetricKey, { def: MetricDefinition;
  compute(pb: PocketBase, tenant: string, period: MetricPeriod): Promise<MetricValue> }>
```

`compute` **återanvänder** befintliga läsvägar i stället för att skriva nya
frågor: konvertering läser `startup_phase_history` via `listAllForTenant`
(paginerat, `complete`-flagga bevaras så en kapad läsning aldrig blir en
felaktig siffra); leads via `getCompassDashboard`/`countLeadsByStatus` i
`lib/compass/store.ts`; Vinnova‑siffror via `buildVinnovaLagesredovisning`.
`app/hem/page.tsx` byter sina inline‑`totalItems`‑räkningar till registret i
samma PR (netto **mindre** kod).

**Art. 9 (§ 10.2):** `women_share` räknas i registret från `founder_gender`
med `shareWithThreshold(k=5)`, returnerar bara ett tal eller `null`, och
lagras aldrig per bolag. `founder_gender` är redan svartlistad i
`lib/ai/context.ts` och fältmaskad i `redaction.ts`; registret exponeras
**inte** som chatt‑verktyg i första steget (agenten läser i stället
`goal_status_entries`, som bara innehåller aggregatet).

### 2.3 Enkätsyfte på Startupkompassen (migration‑only, § 23.4)

`compass_modules` får `purpose` (`intake` default | `survey` | `assessment` |
`checkin`), `subject_kind` (`none`|`startup`|`event`|`partner`|`staff`) och
`anonymous` (bool). `compass_responses` får `subject_id` (text, ej relation —
motorn är generisk) och `subject_kind`. Beteendet styrs på **ett** ställe:
`lead-capture.ts` `moduleWantsLead()` returnerar `false` för allt utom
`intake`, så formulär/quiz/chatt‑routarna behöver ingen ny logik. Anonyma
moduler skriver **ingen** `compass_conversations`‑rad, ingen `session_token`,
ingen `ip_hash` (routen hoppar över `logSecurity` med IP för `anonymous`), och
aggregatet beräknas av en ren `aggregateSurvey(responses, { k: 5 })` i
`@platform/shared/compass-survey.ts` som returnerar `null` under tröskeln.
Befintliga moduler: saknat `purpose` ⇒ `intake` — oapplicerad migration ändrar
aldrig beteendet (§ 24.4‑/§ 30.4‑invarianten), och `updateModuleAction`
avvisar `purpose ≠ intake` mot ett schema utan fältet.

---

## 3. Block för block — vad som läggs till, vad som återanvänds

Formatet är detsamma för varje block: **Schema** (nya migrationer 1700000155+,
oföränderliga, autodate explicit § 28.5, speglade i `setup-via-api.mjs`,
asserterade i `verify-baseline.mjs`) · **Skrivväg** · **Läsväg** · **Chatt** ·
**Säkerhet**.

### 3.1 Målstyrning & VP‑cockpit (`/mal`)

**Schema.** `goal_periods` (tenant, year, title, status draft|active|closed),
`goals` (tenant, period, focus_area select [de fem], title, owner_team select
[marknad|projekt|coach|ledning], sort_order, mission → `missions` valfri),
`goal_indicators` (tenant, goal, label, source select computed|survey|manual,
metric_key text, survey_module → `compass_modules` valfri, target number,
unit, direction), `goal_status_entries` (tenant, indicator, quarter 1–4,
status select on_track|delayed|not_started|done, value number, comment ≤ 2000,
recorded_by). Unikt index `(tenant, indicator, quarter)` → idempotent upsert.
RLS: list/view `STAFF_OR_OBSERVER` (§ 21.3), createRule auth+tenant utan
roll/join, update `:each ?=` admin/incubator_lead + ägande team via
server‑action. Läggs i `MUST_BE_STAFF_OR_OBSERVER`.

**Skrivväg.** `lib/core/write/goals.ts`: `createGoal`, `upsertIndicator`,
`recordGoalStatus`. Policies i `writable-fields.ts` (`goals.*` STAFF_FULL för
människa; agent `allow` på title/comment/status, `deny` på `target`/`metric_key`
— måltal sätts av människa i VP‑beslutet). Validatorer i `validators.ts`
(`validateQuarter`, `validateGoalStatus`, `validateMetricKey` mot registret).
`recordGoalStatus` för `source=computed` **läser värdet ur registret** och
tillåter aldrig ett manuellt tal — en indikator har en källa (princip § 3.2 i
analysen). Fritext (`comment`) personnummer‑saneras på skrivvägen (§ 15.6‑
regexen, samma helper som § 33).

**Läsväg.** `lib/goals/data.ts` (enda läsvägen, fail‑soft), ren
`@platform/shared/goals.ts` (trädbygge, trafikljus, trend, "senast mätt",
kohortval) med tester. `app/mal/page.tsx` + `GoalsView.tsx` återanvänder
`DashSection`/`StatFigure` från `arshjul/Dashboard.tsx` (lyfts till
`components/dashboard/` i samma PR, inga kopior). `app/mal/presentation/`
återanvänder skalet från `/arshjul/presentation`: extrahera
`components/PresentationShell.tsx` (tangenter, helskärm, klocka, refresh) och
gör root‑layoutens "ingen rail"-lista datadriven (`PRESENTATION_PATHS` i
`lib/auth-paths.ts`). Årshjulet får en post "Kvartalsgenomgång" som länkar
till `/mal?q=3`.

**Chatt.** `create_goal`, `set_goal_status` i `tools.ts` (agent‑actor +
`includeWrites`), rader i `DOMAIN_WRITE_TOOLS`, `CHAT_WRITE_ACTIONS_GUIDANCE`,
`chat-guide.ts` (rollkrav speglar policyn) och `agent-log.ts` (etikett + länk
`/mal?goal=<id>`). Läsning via `query_collection` — kollektionerna är inte
denylistade (ingen PII).

**Säkerhet.** Ingen PII. Art. 9‑indikatorn lagrar bara aggregatet (§ 2.2).
Riskklass n/a; en ev. AI‑sammanfattning av kvartalet körs som schemalagd
read‑only‑agent (§ 12) och landar som utkast i `org_posts`/rapport.

### 3.2 Program & gateways

**Schema.** `programs` (tenant, key slug, title, kind select phase|project|
thematic, funding_project → § 3.5 valfri, owner → users, starts_at, ends_at,
gateway_entry json, gateway_exit json, active), `program_enrollments`
(tenant, program, startup cascade, status select applied|active|paused|
completed|exited, entered_at, exited_at, coach → users, gateway_checklist json,
decision_note ≤ 2000, decided_by). Unikt index `(tenant, program, startup,
entered_at)`. `program_rules` — **samma kolumner som `procurement_rules`**
men egen kollektion (olika RLS‑krets) med ankare
`enrollment_start|enrollment_end|phase_entered|program_end` och villkor
`enrollment_active|gateway_pending|no_activity_30d|exceeds_months`.
RLS: `programs` staff/observer; `program_enrollments` medlem‑scopad
(`linked_startups:each ?= startup`) → `MUST_SCOPE_TO_MEMBER`. `tasks.link_kind
+= 'program'`, `tasks.program_enrollment` (relation) → `REQUIRED_APP_FIELDS`.

**Skrivväg.** `lib/core/write/programs.ts`: `createProgram`,
`enrollStartup`, `recordGatewayDecision` (ren `evaluateGateway(criteria,
startup, readiness, agreements)` i `@platform/shared/programs.ts` — läser
`startup_readiness_assessments`, `agreements`, `irl_level` som redan finns).
Fasbyte fortsätter gå via `updateStartupAction` (som redan skriver
`startup_phase_history`); `recordGatewayDecision` anropar **den** i stället
för att skriva fas själv. Agent: `enroll_in_program` allow,
`record_gateway_decision` **deny** (mänskligt beslut, art. 14).

**Läsväg/regler.** `lib/followups/sync.ts` med `programAdapter` (§ 2.1).
Klockorna (tid i fas, 8‑månader, förväntat alumnidatum) är rena funktioner
över `startup_phase_history` + enrollments i `@platform/shared/programs.ts`
och visas på bolagskortet via en ny sektion som återanvänder
`StartupProcurementsSection`‑mönstret.

**Säkerhet.** Beslutsanteckningar personnummer‑saneras; `decision_note` loggas
i audit bara som längd (§ 33‑konventionen). Enrollments är inte denylistade
(bolagsdata, medlem ser sina egna via RLS).

### 3.3 Programansvarig‑cockpit (`/program`)

Ingen ny kollektion, ingen ny skrivväg. `lib/program/data.ts` komponerar
metrikregistret (§ 2.2) + enrollments + `tasks` + `compass_leads` till en
`ProgramCockpit`‑struktur; all beräkning (tratt, median, SLA, belastning,
avvikelser) är rena funktioner i `@platform/shared/program-cockpit.ts` med
tester. **SLA på inflöde** = `compass_leads.created` → första av
`last_contact_at` / `startups.contacted_at`; **belastning** = aktiva
enrollments per coach + `service_time_entries` senaste 30 d (aggregerat per
coach, visas bara för admin/incubator_lead — se § 3.5). Modul `program` med
`rolesAllowed` admin/incubator_lead; coach ser en filtrerad variant (egna
bolag). Läsning via användarens token → RLS.

### 3.4 Feedback & enkäter

Bygger helt på § 2.3. Mallar (`compass-survey-templates.ts` i
`@platform/shared`, samma mönster som `DE_MINIMIS_TEMPLATES`): kundnöjdhet,
NPS event, partnerenkät, medarbetarindex, BC‑ansökan, Team Canvas‑check.
`createModuleAction`/`create_compass_module` tar `template` som redan är
mönstret för agentens modulbygge.

**Utskick.** Ny ren funktion `buildSurveyRecipients(module, subjects)` +
`lib/compass/notify.ts` återanvänder `sendInflowNotification`‑klienten
(Resend, redan godkänd leverantör) med en ny mall `sendSurveyInvite`. Endast
mottagare som finns i redan samtyckta register (`event_signups` med
`contact.gdpr_consent`, `startup_team_members`, `partners`‑kontakter); utskick
kräver `request_approval` från chatten och är en mänsklig knapp i UI:t.
Audit‑rad i `compass_security_events` (`survey_sent`, antal — inga adresser).

**Indikatorkoppling.** `goal_indicators.source = survey` pekar på modulen;
registret exponerar `survey_average(moduleId)` / `survey_nps(moduleId)` som
`MetricDefinition` med `sensitivity: aggregate_only` → tröskel k=5 gäller
automatiskt även kundnöjdhet per bolag (visas som "för få svar" i stället för
tal).

**Säkerhet.** Medarbetarindex: `anonymous=true` ⇒ ingen konversation, ingen
IP, inget lead, `notify_emails` ignoreras, exporten (`/api/inflode/leads/
export`) exkluderar `purpose≠intake`. Dokumenteras i
`docs/privacy/dpia-surveys.md` (kort DPIA‑tillägg, samma mall som mötes‑DPIA:n).

### 3.5 Kapacitet & projektekonomi

**Schema.** `funding_projects` (tenant, key, title, funder, period, status,
budget_lines json [{category, kind income|cost, amount_sek}], requisition_dates
json, reporting_deadlines json, notes), `funding_outcomes` (tenant, project,
month, category, amount_sek, source select manual|import) med unikt index
`(tenant, project, month, category)` → idempotent import (samma
dependency‑fria XLSX‑läsare som CRM‑importen, preview → commit), `capacity_allocations`
(tenant, user cascade, project, percent 0–100, valid_from, valid_to).
`service_time_entries.project` (relation, valfri) — befintliga rader utan
projekt räknas som Bas. `funding_rules` med `fundingAdapter` (ankare
`requisition`, `reporting_deadline`, `project_end`; villkor
`underspent_below_pct`) → rekvisitioner och deadlines blir uppgifter **och**
årshjulsposter via `createAnnualWheelItem` (befintlig skrivfunktion — inte
en kopia).

**RLS.** `funding_*` staff/observer. `capacity_allocations` **admin/
incubator_lead‑only** (personaldata) → `MUST_BE_STAFF_OR_OBSERVER` räcker inte;
ny lista `MUST_BE_LEAD_ONLY` i `verify-baseline.mjs`.

**AI.** `capacity_allocations` läggs i `COLLECTION_DENYLIST` grupp B
(personbunden arbetsdata, Annex III‑gräns). Upparbetning per projekt (aggregat)
görs tillgänglig via metrikregistret och en kurerad read‑only‑funktion
`buildFundingContext` i `lib/ai/context.ts` (whitelist: projekt, budget,
utfall, procent — aldrig person). `service_time_entries` behåller dagens
policy (per individ aggregeras).

**Läsväg.** `upparbetningsgrad = utfall / (budget × andel av perioden)` som ren
funktion i `@platform/shared/funding.ts`; varning ≥ 20 procentenheter under
plan, gul/orange enligt § 2.3 (ingen röd). Rapporten "Ekonomi‑26" genereras
som `incubator_report` via dokumentlagret.

### 3.6 Partnernivåer & kommunrapport

`partners` utökas (migration): `tier` select, `offer_package` text,
`contract_value_sek`, `renews_at`, `owner → users`. `partner_rules` +
`partnerAdapter` (ankare `renews_at`, villkor `not_renewed`) → uppgift 90 d
före förnyelse. Nöjdhet via § 3.4 (`subject_kind=partner`).
**Kommunrapport** = ny mall i `documents/templates.ts` (`kommun_report`) som
matas av registret (`events_per_kommun`, bolag per `startups.kommun`,
`startup_financials.employees`, `capital_rounds`) och renderas av den befintliga
PPTX/PDF‑pipen — agenten `ai_portfolio_overview` får en `{{kommun}}`‑variant i
`prompt_template` (ingen ny agent, en seedmigration som uppdaterar
`tools.prompt_template` + `tool_versions` snapshot via `snapshotToolVersion`).
`events.kommun` läggs till (select över samma kommunlista som `startups`, ur
`@platform/shared`).

### 3.7 Nätverk & community

**Nätverk.** Inga nya kollektioner: `contacts.competences` (multi‑select som
speglar `CompetenceId`, samma regel som `users.competences` § 29.2),
`contacts.contribution_kinds` (mentor|pilot|investor|customer|speaker),
`contacts.last_contact_at`, `contacts.owner → users`. Matchning återanvänder
`lib/ai/team-match.ts` (`matchTeam` tar redan externa kontakter) — bara en ny
inpackning `matchNetworkAction` som byter kandidatkälla. Intro‑logg =
`tasks` (`kind='call'|'email'`, `link_kind='contact'` finns) + `activities`.
Sökning via `search_records` på `contacts` (redan läsbart med fältmaskning).

**Community.** Fyll `/community` för bolagsrollen med `org_posts`
(`audience='all'` finns redan) + `events` + medlemskatalog. Medlemskatalog =
`startups` med nytt `community_opt_in` (bool, sätts av bolaget via
server‑action med `canManageStartupDeMinimis`‑mönstrets medlemskapskontroll) och
en **egen list‑regel**: en medlem ser andra bolag *bara* om
`community_opt_in = true` — det kräver att `startups` list/view‑regeln får en
`|| community_opt_in = true`‑gren för ett **kurerat fältset**. PB kan inte
fältbegränsa per regel → gör det via en **PB‑view‑kollektion**
`community_directory` (id, name, pitch, sector, kommun, website) med
list/view `auth && tenant`; `startups` själv förblir § 21‑isolerad. Viewen
speglas i `setup-via-api.mjs` och asserteras i baseline (cross‑tenant‑scope).
Howspace‑medlemskap per bolag mäts **inte** genom att synka medlemslistor
från Howspace (det vore PII‑matchning av e‑post mot en tredjepart och bryter
§ 11.4:s dataminimering). I stället får `program_enrollments`‑checklistan en
bock "Howspace‑inbjuden" som coachen sätter, och målet 100 % räknas ur den via
metrikregistret.

### 3.8 Ansvarsfull AI‑omställning

`onboarding_flows.audience` (startup default | staff) och
`onboarding_progress.user` (valfri; unikt index `(tenant, flow, user)`
parallellt med det befintliga per startup). `OnboardingRunner` och
`isOnboardingComplete` används oförändrat; `loadFlowAndStartup` får en
`loadFlowAndUser`‑syster i samma fil som delar allt utom subjektet. Ett
`acknowledge`‑block med policytexten är bekräftelsen; slutförande per person
→ metric `staff_onboarded_within_90d` (från `users.created` +
`completed_at`). Onboarding‑rulen (`onbAdapter`: ankare `user_created`,
villkor `not_completed`, offset 60/85 d) skapar påminnelseuppgift till HR.
AI‑stödcheckar registreras via **befintliga** `add_capital_round`/
`register_de_minimis_support` — ingen ny väg.

### 3.9 Automationskatalog

Ren läsvy `/installningar/automationer` över `tool_schedules`,
`tool_triggers`, alla `*_rules`‑kollektioner och enkätutskick, med senaste
körning ur `tool_runs`/`agent_actions`. Backloggen för manuella moment =
`org_posts` med `kind='automation_candidate'` (union på enumet) — inget nytt
register. Triggers utökas i `hooks/event_trigger.pb.js` med
`onRecordAfterUpdateSuccess('startups')` (fasbyte) och `compass_leads` create;
endpointen `/api/internal/run-trigger` och `runTriggeredTool` är oförändrade
(de tar redan `{triggerId, startupId}`; lead‑id läggs som valfritt fält).

---

## 4. Säkerhetschecklista som gäller varje PR (härledd ur § 10.5 + § 21)

1. **Migrationer:** nytt nummer ≥ 1700000155, aldrig redigera applicerade;
   autodate `created/updated` explicit; enum‑utökning som **union**.
   Spegling i `setup-via-api.mjs` (defs + `FORCE_CREATE_RULES` +
   `patchCollection`), assertion i `verify-baseline.mjs` (rätt lista:
   `MUST_SCOPE_TO_MEMBER` / `MUST_BE_STAFF_OR_OBSERVER` / ny
   `MUST_BE_LEAD_ONLY` / `MUST_SCOPE_CROSS_TENANT` / `REQUIRED_APP_FIELDS` /
   must‑exist).
2. **Regler:** `:each ?=` överallt mot multi‑fält; createRule bara
   `@request.auth.id != "" && @request.auth.tenant != ""` — roll i
   server‑action/skrivlager; `writeWithFallback` bara efter verifierad roll +
   tenant (`getRecordInTenant`) och aldrig från agentens verktyg där det inte
   redan görs.
3. **Skrivlagret:** ny rad i `writable-fields.ts` (agent ⊆ människa),
   validator i `validators.ts`, kärnfunktion, `logAgentAction` med PII‑fritt
   `after_value` (fritext som längd), personnummer‑sanering av all fritext.
4. **Läsning:** användarens token (`listAllForTenant`/`getOneForTenant`),
   bunden filtersyntax `pb.filter()` eller `escFilter` (`yarn check:filters`
   fäller bygget), `complete:false` visas som varning — aldrig som ett tal.
5. **AI:** nya kollektioner klassas i `redaction.ts` (denylist eller läsbar
   med fältmaskning); inga nya fält i `context.ts` utan whitelist‑beslut;
   art. 9 bara som k‑anonymt aggregat; nytt verktyg → `DOMAIN_WRITE_TOOLS`,
   guidance, chat‑guide, agent‑log; riskklass i CLAUDE.md § 10.1‑tabellen om
   någon inferens tillkommer.
6. **UI:** semantiska tokens, inga `slate-/red-`, gul/orange för varning
   (§ 2.3), Sora/Nunito ärvs, `design-token-guard`‑agenten körs.
7. **Tester & CI:** ren logik i `@platform/shared` eller `lib/*.test.ts`
   med Node‑runner (`yarn test`), `yarn typecheck`, `yarn build`;
   `compliance-reviewer`‑agenten innan PR öppnas; CLAUDE.md får ett nytt
   avsnitt per block i **samma** PR (§ 10.5 p. 9).
8. **Inga nya beroenden, inga nya leverantörer.** Resend, Mistral, PocketBase
   räcker; XLSX‑import via befintlig läsare; diagram via befintlig
   ECharts‑SSR.

---

## 5. PR‑sekvens (varje PR körbar och värdeskapande för sig)

> **Status 2026‑09‑29:** PR 1–4 är implementerade på branchen
> `claude/movexum-os-analysis-7qs3e2` (regelmotor § 40, metrikregister § 41,
> målstyrning § 42 med chatt‑verktyg och presentationsläge, enkätmotor § 43),
> efterlevnadsgranskade och byggda. PR 5–10 återstår.

| # | PR | Innehåll | Bevis på icke‑duplicering |
| --- | --- | --- | --- |
| 1 | `refactor(followups): generisk regelmotor` | § 2.1. Inga schemaändringar. | `procurement.test.ts` oförändrat grönt + snapshot‑test gammal vs ny väg |
| 2 | `feat(metrics): metrikregister + /hem via registret` | § 2.2. `hem/page.tsx` blir kortare. | Diff visar borttagna inline‑räkningar |
| 3 | `feat(mal): målstyrning & VP‑cockpit` | § 3.1 inkl. `PresentationShell`‑extraktion och `components/dashboard/`. | `/arshjul/presentation` använder den extraherade shellen |
| 4 | `feat(compass): enkätsyfte + mallar + utskick` | § 2.3, § 3.4, DPIA‑tillägg. | `lead-capture.ts` är enda grinden; routarna orörda utom `anonymous`‑hoppet |
| 5 | `feat(program): program, enrollments, gateways, cockpit` | § 3.2–3.3 med `programAdapter`. | Ingen ny synk‑kod; adapter ~80 rader |
| 6 | `feat(funding): projektekonomi, allokering, upparbetning` | § 3.5 med `fundingAdapter`, import preview→commit. | Import återanvänder `lib/import/xlsx.ts` |
| 7 | `feat(partners): nivåer, förnyelse, kommunrapport` | § 3.6 med `partnerAdapter`, dokumentmall. | Rapport via `documents/templates.ts` |
| 8 | `feat(network,community)` | § 3.7. | `matchTeam` återanvänds; view‑kollektion i stället för regelundantag |
| 9 | `feat(onboarding): personalonboarding + AI‑policy` | § 3.8. | Samma `OnboardingRunner` |
| 10 | `feat(automationer): katalog + fler triggers` | § 3.9. | Endpoint/runner oförändrade |

PR 1–3 ryms före teamdagen 27/10 om de prioriteras; PR 4 före
finansieringsdialogen i november (första NPS); PR 5 till styrelsemötet 8/12
(programmål i VP 2027). Resten kvartal 1–2 2027 enligt analysens roadmap.

---

## 6. Öppna beslut som inte är tekniska

- **Måltal 2027** sätts av ledning/styrelse — registret kan räkna, men
  `target` är ett mänskligt fält (agenten får inte skriva det).
- **Medarbetarindex**: bekräfta att ≥ 5 svar är rätt tröskel för en grupp om
  22 personer, och att team‑nedbrytning inte görs (grupper < 5).
- **Community‑opt‑in**: bolagen måste själva välja att synas i katalogen —
  default av.
- **Produktifiering (analysens § 5.3)**: allt ovan byggs tenant‑scopat, men
  vit‑märkning (tema per tenant) är en egen PR som bara ska göras om
  beslutet fattas.
