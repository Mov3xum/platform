/// <reference path="../pb_data/types.d.ts" />

// Belt-and-suspenders re-ensure of the optional `image` file field on both
// `workshops` and `workshop_areas`.
//
// Migration 1700000087 already adds this field. This migration exists because
// the cover-image upload code was deployed to the web app before the
// PocketBase backend (migrations are baked into the PB image and only applied
// on a PB redeploy). When the field is missing, PocketBase SILENTLY ignores
// the uploaded `image` value on update — the file "uploads" but nothing is
// stored, so the education overview shows letter placeholders instead of the
// cover images.
//
// Re-asserting the field under a fresh (guaranteed-unapplied) migration number
// makes the next backend redeploy self-heal that state regardless of whether
// 1700000087 had already been recorded as applied. The body is idempotent:
// it only adds the field when it's actually missing.
//
// Non-protected file field (no token needed) — same pattern as tenant logos
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
  (_app) => {
    // No-op down migration: 1700000087 owns the field's lifecycle, so we don't
    // remove it here (removing it on rollback would drop images that this
    // migration only ensured, not created).
  }
);
