/// <reference path="../pb_data/types.d.ts" />

// Lägger `monthly_ai_budget_usd` (number) på tenants-collectionen — per-tenant
// AI-kostnadstak (USD/kalendermånad). Hanteras av admin via server action
// saveAiBudgetAction (/installningar).
//
// Mönstret följer `disabled_modules` / `allowed_mistral_connectors` på tenants
// — ingen separat tenant_settings-collection.
//
// Semantik (CLAUDE.md § 9.6): tenant-värdet > 0 överstyr env-defaulten
// (MOVEXUM_MONTHLY_AI_BUDGET_USD); 0/tomt = ärver den globala defaulten.
// Spärren enforce:as i lib/ai/budget.server.ts (assertWithinAiBudget).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    collection.fields.add(
      new Field({
        name: 'monthly_ai_budget_usd',
        type: 'number',
        required: false,
        min: 0,
        max: 1000000
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    const field = collection.fields.getByName('monthly_ai_budget_usd');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
