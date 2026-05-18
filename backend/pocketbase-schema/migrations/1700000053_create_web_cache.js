/// <reference path="../pb_data/types.d.ts" />

// Cache-collection för web-fetch-resultaten i `apps/web/src/lib/ai/web.ts`.
// Lagrar saniterad text-blob per källa med TTL 30 min (kontrolleras i kod).
// Inga personuppgifter — bara publika RSS-rubriker och länkar.

// Cachen innehåller bara publika RSS-rubriker och länkar — inga personuppgifter
// och ingen tenant-specifik data. Alla auth-användare kan både läsa och skriva
// (skrivningen sker som bieffekt av att en agent körs, av vilken roll som helst).
const ANY_AUTH = '@request.auth.id != ""';

migrate(
  (app) => {
    const collection = new Collection({
      id: 'web_cache_collection',
      name: 'web_cache',
      type: 'base',
      fields: [
        {
          name: 'source',
          type: 'text',
          required: true,
          min: 1,
          max: 60
        },
        {
          name: 'body',
          type: 'text',
          required: false,
          max: 16000
        },
        {
          name: 'fetched_at',
          type: 'date',
          required: true
        }
      ],
      indexes: [
        'CREATE INDEX idx_web_cache_source ON web_cache (source, fetched_at)'
      ],
      // Auth users kan läsa cachen (transparens); skrivning sker via server actions
      // som använder admin-auth, så list/view räcker att vara auth-only.
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: ANY_AUTH,
      updateRule: ANY_AUTH,
      deleteRule: ANY_AUTH
    });

    return app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('web_cache');
      return app.delete(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
