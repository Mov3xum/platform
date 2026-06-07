/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX: Bolagsisolerings-reglerna (§ 21, migration 1700000096) använde `?=`
// mot multi-select/multi-relation-fält i LIST/VIEW-regler — vilket TYST NEKAR
// alla i PocketBase v0.23.4.
// =============================================================================
//
// BAKGRUND: Migration 1700000049 (`drop_role_checks_from_create_rules`)
// dokumenterade och bekräftade empiriskt att PocketBase v0.23:s regel-
// evaluering INTE matchar `?=`-operatorn mot multi-select-fält som
// `@request.auth.roles` (t.ex. `@request.auth.roles ?= "admin"` blir aldrig
// sant ens för en admin). Lösningen där var att ta bort `?=` ur createRules.
//
// Migration 1700000096 (bolagsisolering, § 21) återinförde dock samma trasiga
// operator — den här gången i LIST/VIEW-regler (och en updateRule) — i tron att
// `?=` fungerar för läs-regler. Det gör det INTE: samma bugg gäller. Följden:
//
//   - `startups` view/list nekar ALLA (även admin) → bolagskortet ger 404
//     (`getOneForTenant` kastar → `notFound()`), portföljlistan blir tom.
//   - Alla barn-kollektioner (activities, notes, milestones, tool_runs, …) och
//     de staff-only-kollektionerna (partners, investors, deals, alumni,
//     integration_records) nekar likaså läsning för alla.
//
// FIX: Skriv om exakt samma regler som 1700000096 satte, men byt `?=` mot
// `:each ?=` — som ÄR korrekt och fungerar i v0.23.4 (verifierat empiriskt mot
// pocketbase 0.23.4 för admin, observer, multi-roll-staff, länkade medlemmar,
// medlemmar länkade till flera bolag, samt icke-länkade medlemmar som korrekt
// nekas). `:each ?=` betyder "någon av (varje) värdena i multi-fältet matchar"
// och bevarar därför EXAKT samma isolerings-semantik som § 21 avsåg.
//
// `@request.auth.id = owner` / `= mentor` (skalär jämförelse mot single-
// relation) berörs inte — den fungerar redan. Endast multi-värde-jämförelserna
// (`@request.auth.roles`, `@request.auth.linked_startups`, `recipients`) byts.
//
// Oföränderlighet (ISO 27001 A.8.32): detta är en NY migration som rättar
// 1700000096 — den migrationen redigeras inte.
// =============================================================================

const ANY_AUTH = '@request.auth.id != ""';

// Staff (admin/incubator_lead/coach/mentor) + observer — KORREKT operator.
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

const TENANT = '@request.auth.tenant = tenant';
const TENANT_VIA_STARTUP = '@request.auth.tenant = startup.tenant';

// Membership — KORREKT operator (`:each ?=` istället för `?=`).
const MEMBER_OF_STARTUP = '@request.auth.linked_startups:each ?= startup';
const MEMBER_OF_THIS = '@request.auth.linked_startups:each ?= id'; // för `startups` själv
// "auth.id finns i postens multi-relation recipients" (missions).
const IS_RECIPIENT = 'recipients:each ?= @request.auth.id';

// -----------------------------------------------------------------------------
// Önskat sluttillstånd — identiskt med 1700000096 förutom operatorbytet.
// -----------------------------------------------------------------------------
const DESIRED = {
  // A) startups själv
  startups: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_THIS})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_THIS})`
  },

  // B1) barn med eget `tenant`-fält + `startup`-relation
  tool_runs: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  sprint_x_checkins: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  startup_phase_history: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  capital_rounds: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  intellectual_property: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  startup_financials: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  education_document_assignments: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  // startup_kpis: bolagsmedlem får skriva egen-bolagsdata (§ 15.5) → scopa
  // även update med korrekt operator.
  startup_kpis: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    update: `${ANY_AUTH} && ${TENANT} && (@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || ${MEMBER_OF_STARTUP})`
  },

  // B2) barn där tenant nås via `startup.tenant`
  activities: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  notes: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP}) && (confidential = false || ${STAFF_OR_OBSERVER} || @request.auth.id = author)`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP}) && (confidential = false || ${STAFF_OR_OBSERVER} || @request.auth.id = author)`
  },
  milestones: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  agreements: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  startup_team_members: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  partner_engagements: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  startup_contacts: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },

  // B3) polymorfa
  tasks: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = owner || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = owner || ${MEMBER_OF_STARTUP})`
  },
  missions: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP} || @request.auth.id = mentor || ${IS_RECIPIENT})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP} || @request.auth.id = mentor || ${IS_RECIPIENT})`
  },

  // C) tenant-breda — medlem nekas helt (staff/observer only)
  partners: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  investors: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  deals: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  alumni: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  },
  integration_records: {
    list: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`,
    view: `${ANY_AUTH} && ${TENANT} && ${STAFF_OR_OBSERVER}`
  }
};

// -----------------------------------------------------------------------------
// down(): återställ till EXAKT 1700000096:s (trasiga) regler, för symmetri.
// -----------------------------------------------------------------------------
const PREV_STAFF_OR_OBSERVER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor" || @request.auth.roles ?= "observer")';
const PREV_MEMBER_OF_STARTUP = '@request.auth.linked_startups ?= startup';
const PREV_MEMBER_OF_THIS = '@request.auth.linked_startups ?= id';
const PREV_IS_RECIPIENT = '@request.auth.id ?= recipients';

const PREVIOUS = {
  startups: {
    list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_THIS})`,
    view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_THIS})`
  },
  tool_runs: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  sprint_x_checkins: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  startup_phase_history: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  capital_rounds: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  intellectual_property: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  startup_financials: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  education_document_assignments: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  startup_kpis: {
    list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`,
    update: `${ANY_AUTH} && ${TENANT} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || ${PREV_MEMBER_OF_STARTUP})`
  },
  activities: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  notes: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP}) && (confidential = false || ${PREV_STAFF_OR_OBSERVER} || @request.auth.id = author)`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP}) && (confidential = false || ${PREV_STAFF_OR_OBSERVER} || @request.auth.id = author)`
  },
  milestones: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  agreements: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  startup_team_members: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  partner_engagements: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  startup_contacts: { list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP})` },
  tasks: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || @request.auth.id = owner || ${PREV_MEMBER_OF_STARTUP})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || @request.auth.id = owner || ${PREV_MEMBER_OF_STARTUP})` },
  missions: { list: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP} || @request.auth.id = mentor || ${PREV_IS_RECIPIENT})`, view: `${ANY_AUTH} && ${TENANT} && (${PREV_STAFF_OR_OBSERVER} || ${PREV_MEMBER_OF_STARTUP} || @request.auth.id = mentor || ${PREV_IS_RECIPIENT})` },
  partners: { list: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}`, view: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}` },
  investors: { list: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}`, view: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}` },
  deals: { list: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}`, view: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}` },
  alumni: { list: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}`, view: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}` },
  integration_records: { list: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}`, view: `${ANY_AUTH} && ${TENANT} && ${PREV_STAFF_OR_OBSERVER}` }
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
    if (rules.update !== undefined && collection.updateRule !== rules.update) {
      collection.updateRule = rules.update;
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
