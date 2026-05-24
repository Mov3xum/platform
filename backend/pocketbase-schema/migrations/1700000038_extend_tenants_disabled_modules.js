/// <reference path="../pb_data/types.d.ts" />

// Lägger till disabled_modules (JSON array) på tenants-collectionen så att
// admins kan stänga av specifika moduler per tenant via Inställningar.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    collection.fields.add(
      new Field({
        name: 'disabled_modules',
        type: 'json',
        required: false,
        maxSize: 4000
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    const field = collection.fields.getByName('disabled_modules');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
