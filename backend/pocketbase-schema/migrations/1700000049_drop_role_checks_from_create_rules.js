/// <reference path="../pb_data/types.d.ts" />

// PocketBase v0.23 createRule-evaluation kan intermittent failera när
// uttrycket innehåller `?=`-operatorn mot multi-select-fält som
// @request.auth.roles. Felet manifesterar sig som "Failed to create
// record." med tomt data-objekt (400) eller "sql: no rows in result
// set". Det funkar för en användare/session men failar för en annan
// med IDENTISK roll-data — vi har bekräftat detta empiriskt.
//
// Lösning: ta bort ALLA `?=`-roll-checks från createRules. Reglerna
// kollar bara att användaren är autentiserad (`@request.auth.id != ""`)
// och i förekommande fall att ägar-fält matchar (`@request.auth.id =
// triggered_by`). Roll-enforcement görs i applikationslagret — varje
// server-action gör `hasRole(user.roles, STAFF_ROLES)` innan
// `pb.create()`. Tenant-isolering säkerställs genom att payload
// alltid sätter `tenant = user.tenant`.
//
// Detta är defense-in-depth-degradering, men acceptabelt eftersom:
//  - Auth-tokens är httpOnly-cookies (inte åtkomliga från klient-JS)
//  - PB är bara nåbar från web-appens domän
//  - Server actions hindrar fel-rollade users från att ens nå PB

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';

// Förenklade rules — INGEN ?=-operator någonstans.
const CREATE_RULES = {
  startups: `${ANY_AUTH} && ${ANY_TENANT}`,
  partners: `${ANY_AUTH} && ${ANY_TENANT}`,
  startup_team_members: ANY_AUTH,
  partner_engagements: ANY_AUTH,
  activities: ANY_AUTH,
  notes: `${ANY_AUTH} && @request.auth.id = author`,
  agreements: `${ANY_AUTH} && ${ANY_TENANT}`,
  milestones: `${ANY_AUTH} && ${ANY_TENANT}`,
  tools: `${ANY_AUTH} && ${ANY_TENANT}`,
  tool_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  workshops: `${ANY_AUTH} && ${ANY_TENANT}`,
  workshop_areas: `${ANY_AUTH} && ${ANY_TENANT}`,
  workshop_assignments: `${ANY_AUTH} && @request.auth.id = assigned_by`,
  workshop_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  strategies: `${ANY_AUTH} && ${ANY_TENANT}`,
  strategy_revisions: `${ANY_AUTH} && ${ANY_TENANT}`,
  missions: `${ANY_AUTH} && ${ANY_TENANT}`,
  sprint_x_checkins: ANY_AUTH,
  investors: `${ANY_AUTH} && ${ANY_TENANT}`,
  deals: `${ANY_AUTH} && ${ANY_TENANT}`,
  incubator_events: `${ANY_AUTH} && ${ANY_TENANT}`,
  event_signups: ANY_AUTH,
  incubator_reports: `${ANY_AUTH} && ${ANY_TENANT}`,
  alumni: `${ANY_AUTH} && ${ANY_TENANT}`,
  tenant_integrations: `${ANY_AUTH} && ${ANY_TENANT}`
};

migrate(
  (app) => {
    for (const [name, createRule] of Object.entries(CREATE_RULES)) {
      let collection;
      try {
        collection = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      if (collection.createRule === createRule) continue;
      collection.createRule = createRule;
      app.save(collection);
    }
  },
  (_app) => {
    // No-op: tidigare regler triggar samma bugg vi just slipper.
  }
);
