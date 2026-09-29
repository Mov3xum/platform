/// <reference path="../pb_data/types.d.ts" />

// AI-minne (CLAUDE.md § 16.4) — kategori per notering så att
// /installningar/ai-minne kan grupperas och filtreras när minnet växer.
// `category` är en VALFRI select över den fasta taxonomin i
// packages/shared/src/agent-memory.ts (AGENT_MEMORY_CATEGORIES). Saknas
// värdet (äldre rader, agenten utelämnade det) härleder appen en kategori
// deterministiskt ur nyckel + innehåll — ingen backfill här, så att en
// människa kan bekräfta i UI:t i stället för att migrationen "gissar" åt dem.
//
// Riskklass n/a: ingen AI-inferens, ingen PII (kategorin är metadata om
// vilken sorts regel noteringen är). Nytt, oföränderligt filnummer
// (§ 10.3 A.8.32). Speglas i setup-via-api.mjs (patchCollection) och
// asserteras i verify-baseline.mjs (REQUIRED_APP_FIELDS) — PB släpper
// okända fält tyst, annars "sparas" kategorin men försvinner.

const CATEGORY_VALUES = [
  'terminologi',
  'datatolkning',
  'arbetssatt',
  'bolag',
  'portfolj',
  'processer',
  'ovrigt'
];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('agent_memory');
    if (!collection.fields.getByName('category')) {
      collection.fields.add(
        new Field({
          name: 'category',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: CATEGORY_VALUES
        })
      );
      app.save(collection);
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('agent_memory');
      const field = collection.fields.getByName('category');
      if (field) collection.fields.removeById(field.id);
      app.save(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
