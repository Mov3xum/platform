/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'alumni_collection',
      name: 'alumni',
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
        { name: 'name', type: 'text', required: true, min: 1, max: 200 },
        { name: 'company', type: 'text', required: false, max: 300 },
        { name: 'exit_year', type: 'number', required: false, min: 1980, max: 2100 },
        {
          name: 'tag',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['exit', 'scale', 'active', 'mentor', 'paused']
        },
        { name: 'bio', type: 'editor', required: false },
        { name: 'contact_email', type: 'email', required: false },
        {
          name: 'contact_user',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'active_mentor', type: 'bool', required: false },
        { name: 'accent', type: 'text', required: false, max: 50 }
      ],
      indexes: ['CREATE INDEX idx_alumni_tenant ON alumni (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('alumni');
    return app.delete(collection);
  }
);
