/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 37 — Hemmaplan. Lägger 'training' (Internutbildning) i
// org_posts.kind som UNION (aldrig ersätt values-listan — § 21.3-läxan från
// migration 1700000049/1700000126) så att fliken "Internutbildningar" på
// startsidan kan fyllas — via UI:t eller via chatt-verktygen
// create_org_post/update_org_post. MÅSTE spegla ORG_POST_KINDS i
// packages/shared/src/org-posts.ts. Ingen PII, ingen AI-inferens.

migrate(
  (app) => {
    const posts = app.findCollectionByNameOrId('org_posts');
    const kindField = posts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('training')) {
        kindField.values = [...current, 'training'];
        app.save(posts);
      }
    }
  },
  (app) => {
    const posts = app.findCollectionByNameOrId('org_posts');
    const kindField = posts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'training');
      app.save(posts);
    }
  }
);
