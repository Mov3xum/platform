/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39.4 — Uppföljning från en källa. En enkät kan skapas "från" en
// aktivitet i årshjulet (kampanj), ett event, en workshop, ett uppdrag, ett
// bolag eller en Startupkompass-modul. Kopplingen är POLYMORF och lagras som
// tre lösa fält (ingen relation → en raderad källa bryter aldrig enkäten;
// etiketten lever kvar). `link_kind` MÅSTE spegla SURVEY_LINK_KINDS i
// packages/shared/src/survey.ts. Källan tenant-verifieras i server-actionen
// innan kopplingen sätts.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    if (!col.fields.getByName('link_kind')) {
      col.fields.add(
        new Field({
          name: 'link_kind',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['annual_wheel', 'event', 'workshop', 'mission', 'startup', 'compass_module']
        })
      );
    }
    if (!col.fields.getByName('link_id')) {
      col.fields.add(new Field({ name: 'link_id', type: 'text', required: false, max: 64 }));
    }
    if (!col.fields.getByName('link_label')) {
      col.fields.add(new Field({ name: 'link_label', type: 'text', required: false, max: 200 }));
    }
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    for (const n of ['link_kind', 'link_id', 'link_label']) {
      const f = col.fields.getByName(n);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
