/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 53.3 — egna utvärderingsmallar. En mall är en vanlig
// `surveys`-rad (samma byggare, samma frågemodell) med:
//
//   • is_template  ← raden är en mall: publiceras aldrig, skickas aldrig,
//                    tar aldrig emot svar (skrivlagret tvingar is_active=false)
//   • template_for ← eventtyper mallen är standard för (multi-select — MÅSTE
//                    spegla EVENT_TYPES i packages/shared/src/event-participants.ts)
//
// När ett event skapas och tenanten har en mall för eventtypen skapas en
// utvärdering som UTKAST kopplad till eventet; en människa granskar och
// publicerar/schemalägger (§ 47.5). Ingen PII, ingen AI-inferens (riskklass
// n/a). Speglas i scripts/setup-via-api.mjs och asserteras i
// verify-baseline.mjs. Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const EVENT_TYPES = ['pitch', 'conference', 'matching', 'hack', 'mingle', 'workshop', 'other'];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    const add = (f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add({ name: 'is_template', type: 'bool', required: false });
    add({ name: 'template_for', type: 'select', required: false, maxSelect: EVENT_TYPES.length, values: EVENT_TYPES });
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    for (const n of ['is_template', 'template_for']) {
      const f = col.fields.getByName(n);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
