/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 34 — mötesläget i chatten. Lägger 'meeting' i activities.kind
// (UNION, aldrig ersätt values-listan — § 21.3-läxan från migration
// 1700000049/1700000126) så att "Möte dokumenterat på <bolag>" syns i den
// globala aktivitetsfeeden när ett mötesprotokoll sparats på bolagskortet.
// Feed-raden är PII-fri (bolagsnamn + typ) — själva protokollet ligger i
// `notes` med befintlig confidential-logik.

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('meeting')) {
        kindField.values = [...current, 'meeting'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'meeting');
      app.save(acts);
    }
  }
);
