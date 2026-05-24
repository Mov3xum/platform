/// <reference path="../pb_data/types.d.ts" />

// PocketBase v0.23 createRule-evaluation kan returnera
// "sql: no rows in result set" när uttrycket refererar en relation-field
// och relationen inte resolvar (eller bara när uttrycket utvärderas till
// false i vissa kantfall). För att undvika problemet en gång för alla:
// createRule innehåller BARA auth-checks som löses från JWT/users-tabellen
// (id, tenant, roles) — INGA referenser till kolumner på den nya posten,
// INGA dotpaths som kräver JOIN. Tenant-isolering på write säkerställs av
// applikationen som alltid sätter tenant=user.tenant i payloaden.
//
// Migrationen körs idempotent (kan re-köras säkert) och sätter samma
// rules som setup-via-api.mjs så att schema och API-sync inte driver isär.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const STAFF_INCL_MENTOR =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const STAFF_OR_LEAD =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

// Mappning: collection-namn → desired createRule.
// Notera: ingen referens till "tenant", "startup.tenant" eller andra
// relation-kolumner på den nya posten — bara auth-fält.
const CREATE_RULES = {
  startups: `${ANY_AUTH} && ${ANY_TENANT}`,
  partners: `${ANY_AUTH} && ${ANY_TENANT}`,
  startup_team_members: ANY_AUTH,
  partner_engagements: ANY_AUTH,
  activities: ANY_AUTH,
  notes: `${ANY_AUTH} && @request.auth.id = author`,
  agreements: `${ANY_AUTH} && ${STAFF_OR_LEAD}`,
  milestones: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  tools: `${ANY_AUTH} && ${ANY_TENANT}`,
  tool_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  workshops: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  workshop_areas: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  workshop_assignments: `${ANY_AUTH} && @request.auth.id = assigned_by`,
  workshop_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  strategies: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  strategy_revisions: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  missions: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  sprint_x_checkins: ANY_AUTH,
  investors: `${ANY_AUTH} && ${STAFF_OR_LEAD}`,
  deals: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  incubator_events: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  event_signups: ANY_AUTH,
  incubator_reports: `${ANY_AUTH} && ${STAFF_OR_LEAD}`,
  alumni: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  tenant_integrations: `${ANY_AUTH} && ${STAFF_OR_LEAD}`
};

migrate(
  (app) => {
    for (const [name, createRule] of Object.entries(CREATE_RULES)) {
      let collection;
      try {
        collection = app.findCollectionByNameOrId(name);
      } catch {
        // Collection finns inte i denna PB-instans — hoppa över.
        continue;
      }
      if (collection.createRule === createRule) continue;
      collection.createRule = createRule;
      app.save(collection);
    }
  },
  (_app) => {
    // No-op: tidigare regler är heterogena och dokumenterade i sina
    // ursprungliga migrationer (0003, 0045, 0046, 0047). Down-migration
    // skulle bara återinföra "sql: no rows"-felet.
  }
);
