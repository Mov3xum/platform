/// <reference path="../pb_data/types.d.ts" />

// Skapar startup_phase_history — en rad per gång ett bolag går in i (eller
// lämnar) en fas. Ersätter de 8 "Inträde X"-kolumnerna i Movexum
// Bolagslista-Excel med en full historik (mer flexibelt, ISO 27001
// A.8.15-kompatibelt audit-trail).
//
// "Antagen till BC" härleds från raden där phase = 'boost_chamber' (äldsta
// entered_at). Inget eget fält på startups (CLAUDE.md § 9.4).

const TENANT_MATCH = '@request.auth.tenant = tenant';
const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'startup_phase_history_collection',
      name: 'startup_phase_history',
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
          name: 'phase',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'paus',
            'inflode',
            'lead',
            'boost_chamber',
            'incubation',
            'prescale',
            'acceleration',
            'alumni'
          ]
        },
        {
          name: 'entered_at',
          type: 'date',
          required: true
        },
        {
          name: 'exited_at',
          type: 'date',
          required: false
        },
        {
          name: 'note',
          type: 'text',
          required: false,
          max: 500
        },
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
        'CREATE INDEX idx_sph_tenant_startup_entered ON startup_phase_history (tenant, startup, entered_at)',
        'CREATE INDEX idx_sph_startup_phase ON startup_phase_history (startup, phase)'
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
    const collection = app.findCollectionByNameOrId('startup_phase_history');
    return app.delete(collection);
  }
);
