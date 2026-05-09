/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'tools_collection',
      name: 'tools',
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
        {
          name: 'key',
          type: 'text',
          required: true,
          min: 1,
          max: 100
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          min: 1,
          max: 200
        },
        {
          name: 'description',
          type: 'editor',
          required: false
        },
        {
          name: 'category',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['ai_per_startup', 'ai_system_wide', 'education', 'template', 'checklist']
        },
        {
          name: 'icon',
          type: 'text',
          required: false,
          max: 50
        },
        {
          name: 'prompt_template',
          type: 'editor',
          required: false
        },
        {
          name: 'model',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest']
        },
        {
          name: 'requires_startup',
          type: 'bool',
          required: false
        },
        {
          name: 'roles_allowed',
          type: 'select',
          required: false,
          maxSelect: 10,
          values: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer']
        },
        {
          name: 'output_format',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['markdown', 'json', 'text']
        },
        {
          name: 'active',
          type: 'bool',
          required: false
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
        'CREATE UNIQUE INDEX idx_tools_tenant_key ON tools (tenant, key)',
        'CREATE INDEX idx_tools_tenant_category ON tools (tenant, category)',
        'CREATE INDEX idx_tools_tenant_active ON tools (tenant, active)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');
    return app.delete(collection);
  }
);
