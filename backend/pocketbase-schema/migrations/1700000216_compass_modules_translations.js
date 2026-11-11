/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — engelsk version av publika moduler (CLAUDE.md § 23.13,
// 2026-11). Personalen översätter modulens besökartexter (rubriker, start-
// sida, samtycke, frågor, svarsalternativ, resultatprofiler) i modul-admin —
// AI-förslag + mänsklig granskning — och publicerar den engelska versionen.
// Den publika sidan /m/<slug> visar då en språkknapp Svenska/English.
//
//   compass_modules.translations (json ≤ 1 MB):
//     { en: { enabled, texts: { <nyckel>: text }, sources: { <nyckel>: hash },
//             updated_at, updated_by } }
//   Nycklarna och normaliseringen bor i packages/shared/src/compass-i18n.ts.
//   Saknat fält ⇒ ingen engelsk version (oförändrat beteende).
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
