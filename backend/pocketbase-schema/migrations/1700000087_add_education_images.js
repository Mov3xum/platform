/// <reference path="../pb_data/types.d.ts" />

// Adds an optional `image` file field to both `workshops` and `workshop_areas`
// so staff can give workshops and areas a cover image in the education module.
// Non-protected file fields (no token needed) — same pattern as tenant logos
// and user avatars. Educational cover imagery is not personal data.

const IMAGE_FIELD = {
  name: 'image',
  type: 'file',
  required: false,
  maxSelect: 1,
  maxSize: 5242880, // 5 MB
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  thumbs: ['800x450', '400x300']
};

migrate(
  (app) => {
    for (const name of ['workshops', 'workshop_areas']) {
      const collection = app.findCollectionByNameOrId(name);
      if (!collection.fields.getByName('image')) {
        collection.fields.add(new Field({ ...IMAGE_FIELD }));
        app.save(collection);
      }
    }
  },
  (app) => {
    for (const name of ['workshops', 'workshop_areas']) {
      try {
        const collection = app.findCollectionByNameOrId(name);
        const field = collection.fields.getByName('image');
        if (field) {
          collection.fields.remove(field.id);
          app.save(collection);
        }
      } catch {
        // Collection already removed.
      }
    }
  }
);
