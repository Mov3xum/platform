/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 47.5 — Utskick av enkät till eventets deltagare. Bara
// AGGREGAT lagras på enkäten (när, hur många) — aldrig mottagarnas
// e-postadresser (GDPR § 5; adresserna läses transient ur event_signups vid
// själva utskicket). `send_at` = schemalagt automatiskt utskick (cron-hooken
// survey_dispatch_tick.pb.js), `sent_at`/`sent_count` = utfört utskick,
// `send_base_url` = origin för enkätlänken (sätts från staffs egen request
// när utskicket schemaläggs — så cron-vägen inte behöver gissa domän).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    const add = (f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add({ name: 'send_at', type: 'date', required: false });
    add({ name: 'sent_at', type: 'date', required: false });
    add({ name: 'sent_count', type: 'number', required: false, min: 0 });
    add({ name: 'send_base_url', type: 'text', required: false, max: 300 });
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('surveys');
    for (const n of ['send_at', 'sent_at', 'sent_count', 'send_base_url']) {
      const f = col.fields.getByName(n);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
