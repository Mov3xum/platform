/// <reference path="../pb_data/types.d.ts" />

// Lägger till `is_pinned` (bool) på user_mistral_connectors så att
// användaren kan välja vilka aktiverade connectors som ska visas som
// chips under chattrutan på /idag-sidan (precis som AI-assistenter).
//
// Begränsning: max 6 pinnade per användare hanteras i koden
// (server action togglePinAction). Default false.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('user_mistral_connectors');
    if (!collection) return;

    const existing = collection.fields.getByName?.('is_pinned');
    if (existing) return;

    collection.fields.add(
      new Field({
        name: 'is_pinned',
        type: 'bool',
        required: false
      })
    );

    app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('user_mistral_connectors');
      const field = collection.fields.getByName?.('is_pinned');
      if (field) {
        collection.fields.removeById(field.id);
        app.save(collection);
      }
    } catch (e) {
      /* ignore */
    }
  }
);
