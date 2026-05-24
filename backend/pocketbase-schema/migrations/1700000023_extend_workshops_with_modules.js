/// <reference path="../pb_data/types.d.ts" />

// Adds a `modules` JSON field to the workshops collection.
// This field stores an array of WorkshopModule objects, each containing
// a list of typed blocks (question, exercise, video, image, test, etc.).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('workshops');

    if (!collection.fields.getByName('modules')) {
      collection.fields.add(
        new Field({
          name: 'modules',
          type: 'json',
          required: false
        })
      );
    }

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshops');
    const field = collection.fields.getByName('modules');
    if (field) collection.fields.remove(field);
    app.save(collection);
  }
);
