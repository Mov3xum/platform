/// <reference path="../pb_data/types.d.ts" />

// Creates the two collections that back the unified integration data
// store:
//
//   integration_records — every entity synced from any provider lands
//     here in a normalised shape. The shape is intentionally generic
//     (title/summary/url/payload) so the UI can render any provider
//     without bespoke code. Idempotency is enforced by a unique index
//     on (tenant_integration, record_type, external_id).
//
//   integration_sync_runs — audit trail for every sync attempt.
//     Required by CLAUDE.md § 10.3 (ISO 27001 A.8.15–A.8.17 logging).
//     error_message must never contain PII.

const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const tiCol = app.findCollectionByNameOrId('tenant_integrations');

    const records = new Collection({
      id: 'integration_records_col',
      name: 'integration_records',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'tenant_integration',
          type: 'relation',
          required: true,
          collectionId: tiCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'provider_slug', type: 'text', required: true, max: 60 },
        { name: 'external_id', type: 'text', required: true, max: 200 },
        { name: 'record_type', type: 'text', required: true, max: 60 },
        { name: 'title', type: 'text', required: false, max: 300 },
        { name: 'summary', type: 'text', required: false, max: 1000 },
        { name: 'url', type: 'text', required: false, max: 1000 },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'occurred_at', type: 'date', required: false },
        { name: 'payload', type: 'json', required: false, maxSize: 20000 },
        { name: 'synced_at', type: 'date', required: true }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_integration_records_unique ON integration_records (tenant_integration, record_type, external_id)',
        'CREATE INDEX idx_integration_records_tenant ON integration_records (tenant)',
        'CREATE INDEX idx_integration_records_provider ON integration_records (provider_slug, record_type)',
        'CREATE INDEX idx_integration_records_occurred ON integration_records (occurred_at)',
        'CREATE INDEX idx_integration_records_startup ON integration_records (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      // Writes only via server-side admin client (sync.ts orchestrator).
      createRule: null,
      updateRule: null,
      deleteRule: null
    });
    app.save(records);

    const runs = new Collection({
      id: 'integration_sync_runs_col',
      name: 'integration_sync_runs',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'tenant_integration',
          type: 'relation',
          required: true,
          collectionId: tiCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'provider_slug', type: 'text', required: true, max: 60 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['started', 'success', 'failed', 'partial']
        },
        {
          name: 'triggered_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'started_at', type: 'date', required: true },
        { name: 'finished_at', type: 'date', required: false },
        { name: 'duration_ms', type: 'number', required: false, min: 0 },
        { name: 'records_created', type: 'number', required: false, min: 0 },
        { name: 'records_updated', type: 'number', required: false, min: 0 },
        { name: 'records_skipped', type: 'number', required: false, min: 0 },
        // Must be PII-free — generic error class + status code only.
        { name: 'error_message', type: 'text', required: false, max: 1000 }
      ],
      indexes: [
        'CREATE INDEX idx_integration_sync_runs_tenant ON integration_sync_runs (tenant, started_at)',
        'CREATE INDEX idx_integration_sync_runs_ti ON integration_sync_runs (tenant_integration, started_at)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      // Writes only via server-side admin client.
      createRule: null,
      updateRule: null,
      deleteRule: null
    });

    return app.save(runs);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('integration_sync_runs'));
    } catch (e) {
      /* ignore */
    }
    try {
      app.delete(app.findCollectionByNameOrId('integration_records'));
    } catch (e) {
      /* ignore */
    }
  }
);
