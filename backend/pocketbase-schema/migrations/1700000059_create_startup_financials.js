/// <reference path="../pb_data/types.d.ts" />

// Creates startup_financials — en rad per (startup, år) med årsvis
// finansiell data (anställda, omsättning, personalkostnad, bolagsskatt).
// Modellerar kolumnerna i Bolagslista-Excel:t som idag är källan för
// Movexums ROI-beräkningar (Statistik 2023-fliken: skatteintäkter,
// överlevnadsgrad, kvar i regionen).
//
// Unique index på (startup, year) gör att framtida sync från Allabolag
// kan göra idempotent upsert utan dubbletter (samma mönster som
// integration_records i 1700000054).
//
// RBAC speglar startups (1700000003): staff (admin/incubator_lead/coach)
// får skriva, alla auth-användare i tenanten får läsa, bara admin kan
// radera.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'startup_financials_col',
      name: 'startup_financials',
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
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'year',
          type: 'number',
          required: true,
          min: 1980,
          max: 2100
        },
        {
          name: 'employees',
          type: 'number',
          required: false,
          min: 0,
          max: 100000
        },
        {
          name: 'revenue_sek',
          type: 'number',
          required: false
        },
        {
          name: 'personnel_cost_sek',
          type: 'number',
          required: false
        },
        {
          name: 'corporate_tax_sek',
          type: 'number',
          required: false
        },
        {
          name: 'source',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['manual', 'import_excel', 'allabolag', 'other']
        },
        {
          name: 'synced_at',
          type: 'date',
          required: false
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_financials_startup_year ON startup_financials (startup, year)',
        'CREATE INDEX idx_financials_tenant ON startup_financials (tenant)',
        'CREATE INDEX idx_financials_year ON startup_financials (year)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('startup_financials');
      app.delete(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
