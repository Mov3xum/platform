/// <reference path="../pb_data/types.d.ts" />

// Onboarding-progress per bolag (CLAUDE.md § 25). En rad per (tenant, flow,
// startup) — bolagets svar/bekräftelser och slutförandestatus för ett
// onboarding-flöde. Idempotent upsert via unikt index → progressen återupptas.
//
// Bolagsisolering (§ 21): en ren startup_member får bara se/uppdatera sitt eget
// bolags progress (list/view scope:ar via linked_startups med `:each ?=`, § 21.3).
// Staff/observer ser hela tenanten. createRule refererar BARA auth-fält (ingen
// roll-check/`= tenant`-join, § 21.3) — server-actionen verifierar medlemskap +
// tenant innan skrivning (superuser-fallback vid PB v0.23-rule-eval-bugg, samma
// mönster som education_document_assignments § 18.3). Riskklass minimal.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_ROLES =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const OWN_STARTUP = '@request.auth.linked_startups:each ?= startup';
const STAFF_OR_LINKED = `(${STAFF_OR_OBSERVER} || ${OWN_STARTUP})`;

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const flowsCol = app.findCollectionByNameOrId('onboarding_flows');
    const usersCol = app.findCollectionByNameOrId('users');
    const activitiesCol = app.findCollectionByNameOrId('activities');

    const collection = new Collection({
      id: 'onboarding_progress_collection',
      name: 'onboarding_progress',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'flow',
          type: 'relation',
          required: true,
          collectionId: flowsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['in_progress', 'completed']
        },
        { name: 'answers_json', type: 'json', required: false },
        { name: 'progress_json', type: 'json', required: false },
        {
          name: 'activity',
          type: 'relation',
          required: false,
          collectionId: activitiesCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'started_at', type: 'date', required: false },
        { name: 'completed_at', type: 'date', required: false },
        {
          name: 'completed_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_onboarding_progress_unique ON onboarding_progress (tenant, flow, startup)',
        'CREATE INDEX idx_onboarding_progress_startup ON onboarding_progress (startup)',
        'CREATE INDEX idx_onboarding_progress_flow ON onboarding_progress (flow)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('onboarding_progress'));
    } catch (e) {
      /* ignore */
    }
  }
);
