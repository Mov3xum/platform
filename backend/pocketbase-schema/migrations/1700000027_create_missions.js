/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'missions_collection',
      name: 'missions',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['workshop', 'sprint_x', 'community', 'report', 'onboarding', 'custom']
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'preparation', 'in_progress', 'review', 'done', 'archived']
        },
        {
          name: 'issuer',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'recipients',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 50
        },
        {
          name: 'mentor',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: 'startups_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'due_date', type: 'date', required: false },
        { name: 'description', type: 'editor', required: false },
        // stages: [{ id, label, actor, time, note, done }]
        { name: 'stages_json', type: 'json', required: false, maxSize: 200000 },
        // artifacts: [{ id, name, size, url, uploaded_by, created }]
        { name: 'artifacts_json', type: 'json', required: false, maxSize: 200000 },
        { name: 'accent', type: 'text', required: false, max: 50 }
      ],
      indexes: [
        'CREATE INDEX idx_missions_tenant ON missions (tenant)',
        'CREATE INDEX idx_missions_status ON missions (status)',
        'CREATE INDEX idx_missions_due ON missions (due_date)'
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
    const collection = app.findCollectionByNameOrId('missions');
    return app.delete(collection);
  }
);
