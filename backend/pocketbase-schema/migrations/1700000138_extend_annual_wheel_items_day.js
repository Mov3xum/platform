/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30) — valfritt specifikt DATUM på en aktivitet.
// Tidigare kunde en post bara knytas till en månad (1–12). Detta lägger ett
// valfritt `day` (1–31) så staff kan ange ett exakt datum (visas vid hovring
// och driver nedräkningen i navet). Fältet är optional → bakåtkompatibelt;
// poster utan dag fortsätter att tolkas som hela månaden.
//
// Riskklass minimal: ingen AI-inferens, ingen PII (intern verksamhetsplanering).
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32). Speglas i setup-via-api.mjs.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('annual_wheel_items');
    collection.fields.add(
      new Field({
        name: 'day',
        type: 'number',
        required: false,
        onlyInt: true,
        min: 1,
        max: 31
      })
    );
    return app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('annual_wheel_items');
      const field = collection.fields.getByName('day');
      if (field) collection.fields.removeById(field.id);
      app.save(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
