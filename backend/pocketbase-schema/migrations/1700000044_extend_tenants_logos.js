/// <reference path="../pb_data/types.d.ts" />

// Adds logo_light and logo_dark file fields to the tenants collection so that
// admins can upload custom logotypes for light and dark mode per tenant.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    collection.fields.add(
      new Field({
        name: 'logo_light',
        type: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 2097152,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
        thumbs: []
      })
    );

    collection.fields.add(
      new Field({
        name: 'logo_dark',
        type: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 2097152,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
        thumbs: []
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    for (const name of ['logo_light', 'logo_dark']) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    return app.save(collection);
  }
);
