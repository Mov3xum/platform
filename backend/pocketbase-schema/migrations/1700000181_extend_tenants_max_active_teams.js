/// <reference path="../pb_data/types.d.ts" />

// Teamtak per tenant (CLAUDE.md § 29.7): max antal pågående tvärfunktionella
// team en person får ingå i samtidigt. Ledningen (admin/incubator_lead)
// justerar värdet i Inställningar → Kompetenser (saveTeamCapAction).
//
// Semantik: tomt/0 ⇒ default 3 (`DEFAULT_MAX_ACTIVE_TEAMS` i
// @platform/shared). Taket är en hård gräns i AI-teamförslaget och när
// deltagare läggs till i ett pågående uppdrag. Ingen PII — ett heltal per
// tenant. Mönstret följer `monthly_ai_budget_usd` (1700000122).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    if (!collection.fields.getByName('max_active_teams_per_person')) {
      collection.fields.add(
        new Field({
          name: 'max_active_teams_per_person',
          type: 'number',
          required: false,
          min: 0,
          max: 20,
          onlyInt: true
        })
      );
    }
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    const field = collection.fields.getByName('max_active_teams_per_person');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
