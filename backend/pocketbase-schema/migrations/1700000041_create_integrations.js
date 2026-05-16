/// <reference path="../pb_data/types.d.ts" />

// Creates two collections that back the /integrationer page:
//
//   integration_providers — global catalog of supported / planned
//     integration providers (Teams, SharePoint, Slack, etc.). One row
//     per provider, shared across all tenants. Authenticated users may
//     list and view; only platform-admins may mutate.
//
//   tenant_integrations — per-tenant connection state for a provider
//     (status = available | pilot_requested | connected | disabled).
//     Pilot requests carry contact info and an optional message so the
//     Movexum team can follow up out-of-band until the OAuth flow is
//     built.

const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const providers = new Collection({
      id: 'integration_providers_col',
      name: 'integration_providers',
      type: 'base',
      fields: [
        { name: 'slug', type: 'text', required: true, min: 1, max: 60 },
        { name: 'name', type: 'text', required: true, min: 1, max: 100 },
        {
          name: 'category',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['microsoft365', 'ai', 'collaboration', 'communication', 'productivity']
        },
        { name: 'placeholder', type: 'text', required: false, max: 8 },
        { name: 'tagline', type: 'text', required: false, max: 200 },
        { name: 'description', type: 'text', required: false, max: 2000 },
        // features: JSON array of strings rendered as bullets on the card.
        { name: 'features', type: 'json', required: false, maxSize: 4000 },
        {
          name: 'availability',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planned', 'beta', 'available']
        },
        { name: 'sort_order', type: 'number', required: false, min: 0 },
        { name: 'active', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_integration_providers_slug ON integration_providers (slug)',
        'CREATE INDEX idx_integration_providers_category ON integration_providers (category, sort_order)'
      ],
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
      updateRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
      deleteRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`
    });

    app.save(providers);

    const tenantIntegrations = new Collection({
      id: 'tenant_integrations_col',
      name: 'tenant_integrations',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'provider',
          type: 'relation',
          required: true,
          collectionId: 'integration_providers_col',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['available', 'pilot_requested', 'connected', 'disabled']
        },
        { name: 'requested_message', type: 'text', required: false, max: 2000 },
        { name: 'requested_at', type: 'date', required: false },
        {
          name: 'requested_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'connected_at', type: 'date', required: false },
        // Config blob reserved for when real OAuth lands (tokens stored
        // encrypted via hooks; never returned in API responses).
        { name: 'config', type: 'json', required: false, maxSize: 50000 }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_tenant_integration_unique ON tenant_integrations (tenant, provider)',
        'CREATE INDEX idx_tenant_integrations_tenant ON tenant_integrations (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(tenantIntegrations);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('tenant_integrations'));
    } catch (e) {
      /* ignore */
    }
    try {
      app.delete(app.findCollectionByNameOrId('integration_providers'));
    } catch (e) {
      /* ignore */
    }
  }
);
