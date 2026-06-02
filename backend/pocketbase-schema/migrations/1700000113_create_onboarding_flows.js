/// <reference path="../pb_data/types.d.ts" />

// Onboarding-flöden (CLAUDE.md § 25). Staff bygger ett flöde av moduler/block
// under /education/onboarding (samma byggar-mönster som workshops) och kan sätta
// ETT flöde per tenant som DEFAULT → det visas då för varje aktivt bolag som
// inte slutfört onboardingen. Informativa moduler om Movexum + inkubatortiden.
//
// Riskklass minimal: ingen AI-inferens, ingen PII (staff-skapade
// utbildningsresurser). Tenant-isolation på list/view; alla tenant-användare får
// LÄSA (bolagsmedlemmen måste kunna läsa default-flödet). createRule refererar
// BARA auth-fält (ingen roll-check, ingen `= tenant`-join) för att undvika PB
// v0.23.4:s rule-eval-buggar (CLAUDE.md § 21.3, verify-baseline.mjs-svepet);
// roll-enforcement görs i server-actions. update/delete behåller roll-check.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'onboarding_flows_collection',
      name: 'onboarding_flows',
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
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        { name: 'intro', type: 'editor', required: false },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'active', 'archived']
        },
        { name: 'is_default', type: 'bool', required: false },
        { name: 'active', type: 'bool', required: false },
        { name: 'modules', type: 'json', required: false },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_onboarding_flows_tenant ON onboarding_flows (tenant)',
        'CREATE INDEX idx_onboarding_flows_tenant_default ON onboarding_flows (tenant, is_default)',
        'CREATE INDEX idx_onboarding_flows_tenant_active ON onboarding_flows (tenant, active)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('onboarding_flows'));
    } catch (e) {
      /* ignore */
    }
  }
);
