/// <reference path="../pb_data/types.d.ts" />

// Extends the existing integrations schema in preparation for real
// data sync (no more pilot-request-only flow):
//
//   integration_providers.category — adds 'marketing' (Brevo) and
//     'learning' (Howspace) to the allowed values.
//
//   tenant_integrations — adds last_sync_at, last_sync_status and
//     last_sync_summary so the UI can show freshness per connection.

migrate(
  (app) => {
    // ── integration_providers.category enum ──────────────────────────
    const providers = app.findCollectionByNameOrId('integration_providers');
    const categoryField = providers.fields.getByName('category');
    if (categoryField) {
      categoryField.values = [
        'microsoft365',
        'ai',
        'collaboration',
        'communication',
        'productivity',
        'marketing',
        'learning'
      ];
      app.save(providers);
    }

    // ── tenant_integrations.last_sync_* ──────────────────────────────
    const ti = app.findCollectionByNameOrId('tenant_integrations');

    if (!ti.fields.getByName('last_sync_at')) {
      ti.fields.add(new Field({
        name: 'last_sync_at',
        type: 'date',
        required: false
      }));
    }
    if (!ti.fields.getByName('last_sync_status')) {
      ti.fields.add(new Field({
        name: 'last_sync_status',
        type: 'select',
        required: false,
        maxSelect: 1,
        values: ['success', 'failed', 'partial']
      }));
    }
    if (!ti.fields.getByName('last_sync_summary')) {
      ti.fields.add(new Field({
        name: 'last_sync_summary',
        type: 'text',
        required: false,
        max: 500
      }));
    }
    app.save(ti);
  },
  (app) => {
    const providers = app.findCollectionByNameOrId('integration_providers');
    const categoryField = providers.fields.getByName('category');
    if (categoryField) {
      categoryField.values = [
        'microsoft365',
        'ai',
        'collaboration',
        'communication',
        'productivity'
      ];
      app.save(providers);
    }

    const ti = app.findCollectionByNameOrId('tenant_integrations');
    ['last_sync_at', 'last_sync_status', 'last_sync_summary'].forEach((name) => {
      const f = ti.fields.getByName(name);
      if (f) ti.fields.remove(f);
    });
    app.save(ti);
  }
);
