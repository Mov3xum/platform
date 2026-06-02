/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// Säkerhetsfix: stäng cross-tenant- och cross-bolag-läckor i RLS (CLAUDE.md
// § 21 + säkerhetsgranskning 2026-06). Komplement till § 21-ramverket
// (migration 1700000096/1700000106) som missade en rad nyare PII-/finans-
// kollektioner som lagts till efteråt.
// =============================================================================
//
// FYND (RLS-regler utan korrekt scope):
//
//   C1 (KRITISK, cross-tenant): `compass_messages` och `compass_responses`
//       saknar tenant-kolumn och hade list/view = `auth && STAFF` UTAN
//       tenant-scope → en staff-användare i tenant A kunde läsa ALLA andra
//       tenants Startupkompass-besökares chattinnehåll och enkätsvar. Vi
//       scopar via förälder-relationen (`conversation.tenant`), som bär tenant.
//
//   M8 (cross-tenant): `tenants` list/view = bara `auth` → vilken inloggad
//       användare som helst kunde enumerera alla tenants (namn/config). Scopas
//       till den egna tenanten (`@request.auth.tenant = id`).
//
//   M9 (cross-tenant): `compass_questions` list/view = `auth` (globalt) →
//       scopas till modulens tenant (`module.tenant`).
//
//   H3–H6 (cross-bolag inom tenant): en ren `startup_member` kunde läsa ALLA
//       bolags rader i tenanten i kollektioner som aldrig skrevs in i § 21:
//         - `contacts` (PII, art. 9 `gender`) → staff/observer-only läsning.
//         - `agreement_signatures` (signer-email + ip_hash) → medlems-scope
//           via `startup`.
//         - `de_minimis_units` / `de_minimis_unit_orgnr` / `de_minimis_stod`
//           (org-nr + statsstödsbelopp) → medlems-scope (§ 20.4: medlem ser
//           bara sitt eget bolag); orgnr scopas via `unit.startup`.
//         - `service_time_entries`, `startup_service_costs`,
//           `startup_readiness_assessments`, `startup_state_aid_periods`
//           (intern tid/kostnad/bedömning) → staff/observer-only.
//         - `event_signups` (deltagar-PII) → medlems-scope via `startup`
//           eller inbjuden `user`.
//         - `mission_comments` → följer uppdragets synlighet (författare,
//           bolagets medlemmar, mentor, staff/observer).
//
// EJ MEDTAGEN (medvetet): `education_documents` (delade utbildningsresurser,
//   ej PII, filerna serveras redan via tokenlös publik URL § 18.3) lämnas
//   tenant-brett läsbara — staff-only skulle bryta medlemmens vy av tilldelade
//   dokument utan att skydda själva filen. `web_cache` / `integration_providers`
//   (globala kataloger/RSS-cache) hanteras i AI-denylistan, inte här.
//
// OPERATOR: PB v0.23.4 matchar INTE `?=` mot multi-värde-fält
// (`@request.auth.roles`, `@request.auth.linked_startups`, `recipients`) i
// list/view-regler — det blir tyst falskt även för en matchande användare
// (CLAUDE.md § 21.3, migration 1700000106). Vi använder därför `:each ?=`
// genomgående. `@request.auth.id = owner`/`= mentor`/`= author` (skalär mot
// single-relation) och relation-hopp `x.tenant`/`x.startup` är oförändrat OK.
//
// Vi rör BARA listRule/viewRule (läs-läckan). createRules lämnas orörda —
// roll-checks/tenant-joins i createRule triggar en separat PB v0.23.4-bugg
// (§ 21.3 / migration 1700000111) och svep-kontrollen i verify-baseline.mjs.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration; tidigare migrations
// redigeras inte.
// =============================================================================

const ANY_AUTH = '@request.auth.id != ""';

// Staff (admin/incubator_lead/coach/mentor) + observer — KORREKT operator.
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

// Compass-staff (matchar migration 1700000109: admin/incubator_lead/coach).
const COMPASS_STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';

const TENANT = '@request.auth.tenant = tenant';
const MEMBER_OF_STARTUP = '@request.auth.linked_startups:each ?= startup';

// -----------------------------------------------------------------------------
// Önskat sluttillstånd (endast list/view).
// -----------------------------------------------------------------------------
const DESIRED = {
  // C1 — cross-tenant: scope via förälder-relationens tenant.
  compass_messages: {
    list: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`,
    view: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`
  },
  compass_responses: {
    list: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`,
    view: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`
  },
  // M9 — cross-tenant: scope via modulens tenant.
  compass_questions: {
    list: `${ANY_AUTH} && @request.auth.tenant = module.tenant`,
    view: `${ANY_AUTH} && @request.auth.tenant = module.tenant`
  },
  // M8 — cross-tenant: bara den egna tenanten.
  tenants: {
    list: `${ANY_AUTH} && @request.auth.tenant = id`,
    view: `${ANY_AUTH} && @request.auth.tenant = id`
  },

  // H3 — contacts: PII (inkl. art. 9 gender), ingen direkt startup-relation
  // (M2M via startup_contacts) → staff/observer-only läsning.
  contacts: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },

  // H4 — agreement_signatures: har direkt startup-relation → medlems-scope.
  agreement_signatures: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },

  // H5 — de minimis: medlem ser bara sitt eget bolag (§ 20.4).
  de_minimis_units: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  de_minimis_unit_orgnr: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.linked_startups:each ?= unit.startup)`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.linked_startups:each ?= unit.startup)`
  },
  de_minimis_stod: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },

  // H6 — intern tid/kostnad/bedömning: staff/observer-only (ej i medlems-railen).
  service_time_entries: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  startup_service_costs: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  startup_readiness_assessments: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  startup_state_aid_periods: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },

  // H6 — event_signups: deltagar-PII → medlem ser sitt-bolags + där hen är
  // inbjuden (`user`); staff/observer ser alla.
  event_signups: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = user || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = user || ${MEMBER_OF_STARTUP})`
  },

  // H6 — mission_comments: staff/observer-only (matchar setup-via-api;
  // konservativt — vi vidgar aldrig en behörighet i en säkerhetsfix).
  mission_comments: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  }
};

// -----------------------------------------------------------------------------
// down(): återställ till de (läckande) reglerna som gällde innan denna migration.
// -----------------------------------------------------------------------------
const PREVIOUS = {
  compass_messages: { list: `${ANY_AUTH} && ${COMPASS_STAFF}`, view: `${ANY_AUTH} && ${COMPASS_STAFF}` },
  compass_responses: { list: `${ANY_AUTH} && ${COMPASS_STAFF}`, view: `${ANY_AUTH} && ${COMPASS_STAFF}` },
  compass_questions: { list: ANY_AUTH, view: ANY_AUTH },
  tenants: { list: ANY_AUTH, view: ANY_AUTH },
  contacts: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  agreement_signatures: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  de_minimis_units: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  de_minimis_unit_orgnr: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  de_minimis_stod: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  service_time_entries: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  startup_service_costs: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  startup_readiness_assessments: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  startup_state_aid_periods: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  event_signups: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` },
  mission_comments: { list: `${ANY_AUTH} && ${TENANT}`, view: `${ANY_AUTH} && ${TENANT}` }
};

function applyRules(app, table) {
  for (const [name, rules] of Object.entries(table)) {
    let collection;
    try {
      collection = app.findCollectionByNameOrId(name);
    } catch {
      // Kollektionen finns inte i denna instans — fail-soft, fortsätt.
      continue;
    }
    if (!collection) continue;
    let changed = false;
    if (rules.list !== undefined && collection.listRule !== rules.list) {
      collection.listRule = rules.list;
      changed = true;
    }
    if (rules.view !== undefined && collection.viewRule !== rules.view) {
      collection.viewRule = rules.view;
      changed = true;
    }
    if (changed) {
      app.save(collection);
    }
  }
}

migrate(
  (app) => {
    applyRules(app, DESIRED);
  },
  (app) => {
    applyRules(app, PREVIOUS);
  }
);
