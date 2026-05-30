/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// Bolagsisolering / RLS för rollen `startup_member` (CLAUDE.md § 6, § 19).
// =============================================================================
//
// PROBLEM: Tidigare list/view-regler var i de flesta fall
//   `@request.auth.id != "" && @request.auth.tenant = tenant`
// vilket gör att VILKEN autentiserad användare som helst i tenanten — inklusive
// en ren `startup_member` — kunde läsa ALLA bolag och all bolagsdata i tenanten.
// Det är dataläckan vi stänger här.
//
// MÅL: En ren `startup_member` ska BARA kunna läsa data knuten till sitt/sina
// egna bolag (`users.linked_startups`). Staff (admin / incubator_lead / coach /
// mentor) och `observer` (intern tillsynsroll) behåller tenant-bred läsning.
//
// DEFENSE-IN-DEPTH: detta är RLS-lagret (sanna PocketBase API-regler). App-lagret
// (server actions / pages) filtrerar dessutom — se `apps/web/src/lib/pb.server.ts`
// (`startupScopeFilter`) och sidornas RBAC-guards.
//
// PB v0.23-bugg (migration 1700000049): `?=`/`?~`-roll-checks mot
// `@request.auth.roles` får ALDRIG ligga i createRules. Det gäller INTE
// list/view/update/delete-regler (de används redan brett i schemat och
// fungerar). Vi rör därför ENBART listRule/viewRule (+ enstaka update/delete
// där en medlem redan får skriva egen-bolagsdata) och lämnar alla createRules
// orörda.
//
// MEMBERSHIP-SYNTAX: `@request.auth.linked_startups ?= <startup-relation>` =
// "någon av användarens länkade startups matchar postens startup-relation".
// Samma mönster som redan används i workshop_assignments / workshop_runs /
// strategies (`STAFF_OR_LINKED_STARTUP`).
//
// -----------------------------------------------------------------------------
// KOLLEKTIONER SOM RÖRS
// -----------------------------------------------------------------------------
// A) `startups` själv — medlem ser bara rader där id finns i linked_startups.
//
// B) Barn-kollektioner med direkt `startup`-relation → medlem ser bara rader
//    för sina länkade bolag. (tenant nås via egen `tenant` ELLER `startup.tenant`
//    beroende på kollektion — se kartan nedan.)
//      tenant-fält:        tool_runs, sprint_x_checkins, startup_phase_history,
//                          capital_rounds, intellectual_property, startup_kpis,
//                          startup_financials, education_document_assignments
//      startup.tenant:     activities, notes, milestones, agreements,
//                          startup_team_members, partner_engagements,
//                          startup_contacts
//    `tasks` (polymorf): medlem ser egna (owner) + sitt-bolags-tasks.
//    `missions` (polymorf): medlem ser sitt-bolags + där hen är recipient/mentor.
//
// C) Tenant-breda kollektioner med ANDRA bolags / pipeline / lead-data som en
//    medlem inte alls får läsa → list/view = staff+observer only:
//      partners, investors, deals, alumni, integration_records.
//    (incubator_reports och tenant_integrations är redan staff-only;
//     compass_leads/_conversations/_responses är redan staff-only.)
//
// EJ RÖRDA (redan medlem-scopade via `STAFF_OR_LINKED_STARTUP`):
//   workshop_assignments, workshop_runs, strategies, strategy_revisions.
// EJ RÖRDA (notes har egen confidential-logik som redan respekteras; vi lägger
//   bara på medlems-scope ovanpå).
//
// Konservativt: där vi är osäkra scopar vi ENBART läsning (list/view) och rör
// inte skrivreglerna. Undantag: startup_kpis + sprint_x_checkins där en
// bolagsmedlem redan får skriva egen data (CLAUDE.md § 15.5) — där scopar vi
// update så att medlemmen bara kan ändra sitt eget bolags rader.
// =============================================================================

const ANY_AUTH = '@request.auth.id != ""';

// Staff (admin/incubator_lead/coach/mentor) + observer behåller tenant-bred read.
const STAFF_OR_OBSERVER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor" || @request.auth.roles ?= "observer")';

// Tenant-checkar (två varianter beroende på var tenant-relationen sitter).
const TENANT = '@request.auth.tenant = tenant';
const TENANT_VIA_STARTUP = '@request.auth.tenant = startup.tenant';

// Membership-fragment.
const MEMBER_OF_STARTUP = '@request.auth.linked_startups ?= startup';
const MEMBER_OF_THIS = '@request.auth.linked_startups ?= id'; // för `startups` själv

// -----------------------------------------------------------------------------
// Önskat sluttillstånd per kollektion (endast list/view, + ev. update).
// Varje rad: { list, view, update? }. Saknas en nyckel rörs den inte.
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
  // update så medlem bara kan ändra sitt eget bolags rader.
  startup_kpis: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    update: `${ANY_AUTH} && ${TENANT} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || ${MEMBER_OF_STARTUP})`
  },

  // B2) barn där tenant nås via `startup.tenant`
  activities: {
    list: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP})`
  },
  // notes har redan confidential-logik. Vi behåller den OCH lägger på medlems-scope.
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
  // tasks: medlem ser egna (owner) + sitt-bolags-tasks. Behåll befintlig
  // owner-baserad update/delete (rörs ej här).
  tasks: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = owner || ${MEMBER_OF_STARTUP})`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || @request.auth.id = owner || ${MEMBER_OF_STARTUP})`
  },
  // missions: medlem ser sitt-bolags, samt missions där hen är recipient/mentor.
  missions: {
    list: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP} || @request.auth.id = mentor || @request.auth.id ?= recipients)`,
    view: `${ANY_AUTH} && ${TENANT} && (${STAFF_OR_OBSERVER} || ${MEMBER_OF_STARTUP} || @request.auth.id = mentor || @request.auth.id ?= recipients)`
  },

  // C) tenant-breda — medlem får INTE läsa alls (staff/observer only)
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
// Tidigare regler (för `down()`). Dokumenterade baslinjer från respektive
// create-migration. Vi återställer list/view (+ ev. update) till dessa.
// -----------------------------------------------------------------------------
const PREV_TENANT = '@request.auth.tenant = tenant';
const PREV_TENANT_VIA_STARTUP = '@request.auth.tenant = startup.tenant';
const PREV_STAFF_OR_MEMBER_KPI =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "startup_member")';
const PREV_STAFF_OR_OWNER_NOTES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

const PREVIOUS = {
  startups: {
    list: `${ANY_AUTH} && ${PREV_TENANT}`,
    view: `${ANY_AUTH} && ${PREV_TENANT}`
  },
  tool_runs: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  sprint_x_checkins: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  startup_phase_history: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  capital_rounds: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  intellectual_property: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  startup_financials: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  education_document_assignments: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  startup_kpis: {
    list: `${ANY_AUTH} && ${PREV_TENANT}`,
    view: `${ANY_AUTH} && ${PREV_TENANT}`,
    update: `${ANY_AUTH} && ${PREV_TENANT} && ${PREV_STAFF_OR_MEMBER_KPI}`
  },
  activities: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  notes: {
    list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP} && (confidential = false || ${PREV_STAFF_OR_OWNER_NOTES} || @request.auth.id = author)`,
    view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP} && (confidential = false || ${PREV_STAFF_OR_OWNER_NOTES} || @request.auth.id = author)`
  },
  milestones: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  agreements: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  startup_team_members: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  partner_engagements: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  startup_contacts: { list: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}`, view: `${ANY_AUTH} && ${PREV_TENANT_VIA_STARTUP}` },
  tasks: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  missions: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  partners: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  investors: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  deals: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  alumni: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` },
  integration_records: { list: `${ANY_AUTH} && ${PREV_TENANT}`, view: `${ANY_AUTH} && ${PREV_TENANT}` }
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
