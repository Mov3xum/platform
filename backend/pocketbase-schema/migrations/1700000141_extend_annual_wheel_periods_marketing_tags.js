/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30) — KAMPANJPERIODER + MARKNADSKANAL-TAGGAR.
//
// 1) `end_month` (1–12) + `end_day` (1–31), båda valfria. En aktivitet med
//    slutmånad är en PERIOD (kampanj som löper över tid) och ritas som en båge
//    i hjulet i stället för en punkt. Tomma fält = punktaktivitet precis som
//    förut → bakåtkompatibelt.
// 2) `tags` utökas med marknadskanaler (linkedin, nyhetsbrev, event, pr,
//    webinar, annonsering) så att tagg-uppföljningen fungerar för
//    marknadsaktiviteter och inte bara styrelse-/ledningsspåren. Union med de
//    befintliga värdena → inga rader bryts.
//
// Riskklass minimal: ingen AI-inferens, ingen PII (intern verksamhetsplanering).
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32). Speglas i setup-via-api.mjs
// (inline-def + patchCollection) och asserteras i verify-baseline.mjs.

const TAG_VALUES = [
  'kampanjer',
  'verksamhetsrapporter',
  'projekt',
  'team',
  'ledningsgrupp',
  'projektstyrgrupper',
  'ovrigt',
  'linkedin',
  'nyhetsbrev',
  'event',
  'pr',
  'webinar',
  'annonsering'
];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('annual_wheel_items');

    if (!collection.fields.getByName('end_month')) {
      collection.fields.add(
        new Field({ name: 'end_month', type: 'number', required: false, onlyInt: true, min: 1, max: 12 })
      );
    }
    if (!collection.fields.getByName('end_day')) {
      collection.fields.add(
        new Field({ name: 'end_day', type: 'number', required: false, onlyInt: true, min: 1, max: 31 })
      );
    }

    // Union av befintliga + nya taggvärden (aldrig ersätt — det skulle göra
    // befintliga rader ogiltiga).
    const tags = collection.fields.getByName('tags');
    if (tags) {
      const existing = Array.isArray(tags.values) ? tags.values : [];
      const merged = existing.slice();
      for (const value of TAG_VALUES) {
        if (merged.indexOf(value) === -1) merged.push(value);
      }
      tags.values = merged;
      tags.maxSelect = merged.length;
    }

    return app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('annual_wheel_items');
      for (const name of ['end_month', 'end_day']) {
        const field = collection.fields.getByName(name);
        if (field) collection.fields.removeById(field.id);
      }
      app.save(collection);
    } catch (e) {
      /* ignore — taggvärdena rullas medvetet inte tillbaka (rader kan använda dem) */
    }
  }
);
