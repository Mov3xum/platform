/// <reference path="../pb_data/types.d.ts" />

const PROBLEMATIC_TENANT_CREATE_MATCH = '@request.auth.tenant = tenant';
const SAFE_TENANT_CREATE_GUARD = '@request.auth.tenant != ""';

const COLLECTIONS_TO_PATCH = [
  'startups',
  'partners',
  'startup_team_members',
  'partner_engagements',
  'activities',
  'notes',
  'agreements',
  'milestones',
  'tools',
  'tool_runs',
  'workshops',
  'workshop_areas',
  'workshop_assignments',
  'workshop_runs',
  'strategies',
  'strategy_revisions',
  'missions',
  'sprint_x_checkins',
  'investors',
  'deals',
  'incubator_events',
  'event_signups',
  'incubator_reports',
  'alumni',
  'tenant_integrations'
];

function patchCreateRule(app, collectionName, fromValue, toValue) {
  let collection = null;
  try {
    collection = app.findCollectionByNameOrId(collectionName);
  } catch {
    return;
  }
  if (!collection?.createRule || !collection.createRule.includes(fromValue)) return;

  collection.createRule = collection.createRule.split(fromValue).join(toValue);
  app.save(collection);
}

migrate(
  (app) => {
    for (const collectionName of COLLECTIONS_TO_PATCH) {
      patchCreateRule(
        app,
        collectionName,
        PROBLEMATIC_TENANT_CREATE_MATCH,
        SAFE_TENANT_CREATE_GUARD
      );
    }
  },
  (app) => {
    for (const collectionName of COLLECTIONS_TO_PATCH) {
      patchCreateRule(
        app,
        collectionName,
        SAFE_TENANT_CREATE_GUARD,
        PROBLEMATIC_TENANT_CREATE_MATCH
      );
    }
  }
);
