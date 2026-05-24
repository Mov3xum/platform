/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'workshops_collection',
      name: 'workshops',
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
          name: 'title',
          type: 'text',
          required: true,
          min: 1,
          max: 200
        },
        {
          name: 'goal',
          type: 'editor',
          required: false
        },
        {
          name: 'instructions',
          type: 'editor',
          required: false
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'active', 'archived']
        },
        {
          name: 'version',
          type: 'text',
          required: true,
          min: 1,
          max: 20
        },
        {
          name: 'audience_roles',
          type: 'select',
          required: false,
          maxSelect: 7,
          values: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer']
        },
        {
          name: 'ai_system_prompt',
          type: 'editor',
          required: false
        },
        {
          name: 'output_requirements',
          type: 'editor',
          required: false
        },
        {
          name: 'content_blocks',
          type: 'json',
          required: false
        },
        {
          name: 'source_tool',
          type: 'relation',
          required: false,
          collectionId: 'tools_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
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
        'CREATE UNIQUE INDEX idx_workshops_tenant_key ON workshops (tenant, key)',
        'CREATE INDEX idx_workshops_tenant_status ON workshops (tenant, status)',
        'CREATE INDEX idx_workshops_tenant_active ON workshops (tenant, active)'
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
    const collection = app.findCollectionByNameOrId('workshops');
    return app.delete(collection);
  }
);
