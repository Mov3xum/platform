/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 11.8 / § 51 — beslutad vinstutdelning per räkenskapsår.
//
// Art. 22 GBER kräver att bolaget INTE "delat ut vinst". Resultaträkningen
// (Roaring economy-overview) säger inget om det — utdelningen står i
// årsredovisningens vinstdisposition, som den nya datadelen `annual_report`
// (Roaring financial-record, "Årsredovisningar 1.0") hämtar. Bedömning
// excellens avgör då punkten ur registret i stället för manuellt.
//
//   dividend_sek       beslutad utdelning för året (0 = ingen utdelning)
//   dividend_reported  sant när årsredovisningen faktiskt svarade — PB lagrar
//                      0 för ett tomt tal, så siffran ensam kan inte skilja
//                      "ingen utdelning" från "inte hämtad" (§ 42.2-mönstret
//                      med has_target/has_value)
//
// Publik årsredovisningsdata om juridiska personer — ingen PII. Speglas i
// setup-via-api.mjs (patchCollection) och asserteras i verify-baseline.mjs
// (REQUIRED_APP_FIELDS) eftersom PB släpper okända fält tyst (§ 24.4).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('startup_financials');
    if (!col.fields.getByName('dividend_sek')) {
      col.fields.add(new Field({ name: 'dividend_sek', type: 'number', required: false, min: 0 }));
    }
    if (!col.fields.getByName('dividend_reported')) {
      col.fields.add(new Field({ name: 'dividend_reported', type: 'bool', required: false }));
    }
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('startup_financials');
    for (const name of ['dividend_sek', 'dividend_reported']) {
      const f = col.fields.getByName(name);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
