/// <reference path="../pb_data/types.d.ts" />
// CLAUDE.md § 56 / § 58 (2026-11-09) — Impact Navigator och Export Lab öppnas
// för bolagsmedlemmar: en `startup_member` får läsa och arbeta med analysen för
// det EGNA bolaget (`users.linked_startups`), aldrig andra bolag. Movexum-
// personal och observer är oförändrade (tenant-bred läsning; personal driver;
// ledningen tar bort).
//
// Regelmönster (§ 21.3 — `:each ?=` mot multi-värde-fält, aldrig `?=`):
//   list/view: staff/observer ELLER länkad medlem (direkt `startup` eller via
//              förälderanalysen `assessment.startup` där kollektionen saknar
//              eget startup-fält: gap-frågor, väsentlighetsjusteringar,
//              marknadsbeslut).
//   update:    Movexum-personal ELLER länkad medlem (medlemmen svarar på
//              frågor, godkänner väsentlighet/marknader, driver stegen).
//   delete:    ledningen; dokument får dessutom tas bort av den länkade
//              medlem som själv laddade upp dem.
//   create:    orörd (pinnad tenant + skapare, ingen roll-check — § 21.3/§ 21.8).
//
// Koden är den primära gränsen (`canWorkOnImpactCompany`/
// `canWorkOnExportCompany` i @platform/shared, server actions och route
// handlers); reglerna här är defense-in-depth. Speglas i
// scripts/setup-via-api.mjs (SUST_RULES) och asserteras i verify-baseline.mjs
// (kollektionerna flyttas från MUST_BE_STAFF_OR_OBSERVER till
// MUST_SCOPE_TO_MEMBER). AI-denylistan är oförändrad.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration; 1700000206/1700000210
// redigeras inte.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

/** Länkad bolagsmedlem — `scope` är fältet som bär bolaget (`startup` eller `assessment.startup`). */
const member = (scope) => `(@request.auth.roles:each ?= "startup_member" && @request.auth.linked_startups:each ?= ${scope})`;

const MEMBER_RULES = (scope, opts) => ({
  listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${member(scope)})`,
  viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${member(scope)})`,
  updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || ${member(scope)})`,
  deleteRule:
    opts && opts.memberDeletesOwn
      ? `${ANY_AUTH} && ${TENANT_MATCH} && (${LEAD} || (${member(scope)} && ${opts.memberDeletesOwn} = @request.auth.id))`
      : `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
});

const STAFF_RULES = {
  listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
  viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
  updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
};

const TARGETS = [
  ['sustainability_assessments', 'startup', null],
  ['sustainability_gap_questions', 'assessment.startup', null],
  ['sustainability_materiality_overrides', 'assessment.startup', null],
  ['sustainability_update_events', 'startup', null],
  ['sustainability_documents', 'startup', 'uploaded_by'],
  ['sustainability_ai_jobs', 'startup', null],
  ['export_assessments', 'startup', null],
  ['export_gap_questions', 'assessment.startup', null],
  ['export_market_reviews', 'assessment.startup', null],
  ['export_update_events', 'startup', null],
  ['export_documents', 'startup', 'uploaded_by'],
  ['export_ai_jobs', 'startup', null]
];

function applyRules(app, rulesFor) {
  for (const [name, scope, ownField] of TARGETS) {
    let col;
    try {
      col = app.findCollectionByNameOrId(name);
    } catch (e) {
      continue; // instansen saknar kollektionen (migration 1700000206/1700000210 ej körd) — hoppa
    }
    const rules = rulesFor(scope, ownField);
    col.listRule = rules.listRule;
    col.viewRule = rules.viewRule;
    col.updateRule = rules.updateRule;
    col.deleteRule = rules.deleteRule;
    app.save(col);
  }
}

migrate(
  (app) => {
    applyRules(app, (scope, ownField) => MEMBER_RULES(scope, ownField ? { memberDeletesOwn: ownField } : null));
  },
  (app) => {
    applyRules(app, () => STAFF_RULES);
  }
);
