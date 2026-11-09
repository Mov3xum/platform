/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 51.8 — `startup_screenings.context` (json): det serialiserade
// UNDERLAGET för en körning av Bedömning excellens (samma format som
// omräkningen i vyn använder, `lib/excellence/context.ts`), så bedömningen
// kan räknas om från bolagskortet eller svarssidan på en komplettering —
// med ett klick och UTAN nya leverantörsanrop (credits) — när coach/bolag
// svarat. Transienta namn på fysiska personer (verklig huvudman,
// `person_name`) strippas INNAN lagring; grundarnamn ur teamet på
// bolagskortet finns kvar (samma staff-krets). Kollektionen är staff/
// observer-RLS och AI-denylistad (§ 9.3). Speglas i setup-via-api.mjs och
// asserteras i verify-baseline.mjs (PB släpper okända fält tyst, § 24.4).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('startup_screenings');
    if (!col.fields.getByName('context')) {
      col.fields.add(new Field({ name: 'context', type: 'json', required: false, maxSize: 2000000 }));
      app.save(col);
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('startup_screenings');
    const f = col.fields.getByName('context');
    if (f) {
      col.fields.removeById(f.id);
      app.save(col);
    }
  }
);
