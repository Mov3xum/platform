/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX: `incubator_reports` (migration 1700000034) använde `?=` mot multi-
// select-fältet `@request.auth.roles` i LIST/VIEW/UPDATE/DELETE-reglerna —
// vilket TYST NEKAR alla (även admin) i PocketBase v0.23.4.
// =============================================================================
//
// BAKGRUND: Migration 1700000049 (`drop_role_checks_from_create_rules`)
// dokumenterade och bekräftade empiriskt att PocketBase v0.23:s regel-
// evaluering INTE matchar `?=`-operatorn mot multi-select-fält som
// `@request.auth.roles` (t.ex. `@request.auth.roles ?= "admin"` blir aldrig
// sant ens för en admin). Migration 1700000106 rättade samma bugg i § 21:s
// bolagsisolerings-regler genom att byta `?=` mot `:each ?=`.
//
// `incubator_reports` föll mellan stolarna: det är en staff-only-kollektion
// (inte en startup-barn-kollektion) och rördes därför aldrig av 1700000096/106.
// Dess createRule relaxades av 1700000048/049, så att SKAPA en rapport går —
// men VIEW/LIST-reglerna har kvar det trasiga `?=`. Följden: rapporten skapas,
// appen redirectar till `/rapporter/<id>`, och `getOne` nekas av viewRule →
// PocketBase svarar 404 ("sql: no rows in result set") även för admin.
//
// FIX: Skriv om list/view/update/delete med `:each ?=` (korrekt operator i
// v0.23.4). Semantiken är identisk med 1700000034:s avsikt — staff
// (admin/incubator_lead) läser/skriver tenant-data, admin raderar.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration som rättar 1700000034 —
// den migrationen redigeras inte.
// =============================================================================

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';

// KORREKT operator (`:each ?=`) — staff (admin/incubator_lead).
const STAFF_ONLY =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const IS_ADMIN = '@request.auth.roles:each ?= "admin"';

// Föregående (trasiga) tillstånd från 1700000034 — för down().
const PREV_STAFF_ONLY =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const PREV_IS_ADMIN = '@request.auth.roles ?= "admin"';

const DESIRED = {
  list: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
  view: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
  update: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
  delete: `${ANY_AUTH} && ${TENANT_MATCH} && ${IS_ADMIN}`
};

const PREVIOUS = {
  list: `${ANY_AUTH} && ${TENANT_MATCH} && ${PREV_STAFF_ONLY}`,
  view: `${ANY_AUTH} && ${TENANT_MATCH} && ${PREV_STAFF_ONLY}`,
  update: `${ANY_AUTH} && ${TENANT_MATCH} && ${PREV_STAFF_ONLY}`,
  delete: `${ANY_AUTH} && ${TENANT_MATCH} && ${PREV_IS_ADMIN}`
};

function applyRules(app, rules) {
  let collection;
  try {
    collection = app.findCollectionByNameOrId('incubator_reports');
  } catch {
    // Kollektionen finns inte i denna instans — fail-soft.
    return;
  }
  if (!collection) return;
  let changed = false;
  if (collection.listRule !== rules.list) {
    collection.listRule = rules.list;
    changed = true;
  }
  if (collection.viewRule !== rules.view) {
    collection.viewRule = rules.view;
    changed = true;
  }
  if (collection.updateRule !== rules.update) {
    collection.updateRule = rules.update;
    changed = true;
  }
  if (collection.deleteRule !== rules.delete) {
    collection.deleteRule = rules.delete;
    changed = true;
  }
  // createRule lämnas orörd (relaxad av 1700000048/049 — får aldrig role-`?=`).
  if (changed) {
    app.save(collection);
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
