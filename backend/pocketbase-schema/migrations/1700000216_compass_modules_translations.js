/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — engelsk version av publika moduler (CLAUDE.md § 23.13,
// 2026-11). Den publika sidan /m/<slug> har en språkknapp Svenska/English;
// modulens besökartexter (rubriker, startsida, samtycke, frågor,
// svarsalternativ, resultatprofiler) maskinöversätts automatiskt (Mistral,
// EU) första gången en besökare väljer English och sparas här.
//
//   compass_modules.translations (json ≤ 1 MB):
//     { en: { texts: { <nyckel>: text }, sources: { <nyckel>: hash },
//             updated_at } }
//   Nycklarna och normaliseringen bor i packages/shared/src/compass-i18n.ts.
//   Saknat fält ⇒ översättningen kan inte sparas (görs om vid varje visning,
//   med paus) — kör migrationen.
//
// Ingen PII (modulens egna marknadstexter). Compass är migration-only
// (§ 23.4) men compass_modules inline-def i setup-via-api.mjs speglar fältet.
// Oföränderlig migration (§ 10.3 A.8.32).

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    if (!modules.fields.getByName('translations')) {
      modules.fields.add(new Field({ name: 'translations', type: 'json', required: false, maxSize: 1000000 }));
      app.save(modules);
    }
  },
  (app) => {
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const f = modules.fields.getByName('translations');
      if (f) {
        modules.fields.removeById(f.id);
        app.save(modules);
      }
    } catch (e) {
      /* ignore */
    }
  }
);
