/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 11.8 — bolagsregister-providers (Roaring, Bolagsverket).
//
// Bizmaker-kartans tröskelvärden för småföretag (art. 22 GBER / SMF-
// definitionen, bilaga I) kräver BALANSOMSLUTNING utöver omsättning och
// anställda, och Vinnovas "ej marknadsredo"-kriterium jämför EGET KAPITAL mot
// omkostnaderna kommande 24 månader. Båda saknades i `startup_financials`.
//
//   balance_sheet_sek  balansomslutning
//   equity_sek         eget kapital
//   net_result_sek     årets resultat
//
// `source` får dessutom 'roaring' och 'bolagsverket' som UNION (aldrig ersätt
// values-listan — § 21.3-läxan från 1700000049/1700000126).
//
// Publik årsredovisningsdata om juridiska personer — ingen PII. Speglas i
// setup-via-api.mjs (patchCollection) och asserteras i verify-baseline.mjs
// (REQUIRED_APP_FIELDS) eftersom PB släpper okända fält tyst (§ 24.4).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('startup_financials');

    const addNumber = (name) => {
      if (!col.fields.getByName(name)) {
        col.fields.add(new Field({ name, type: 'number', required: false }));
      }
    };
    addNumber('balance_sheet_sek');
    addNumber('equity_sek');
    addNumber('net_result_sek');

    const source = col.fields.getByName('source');
    if (source) {
      const current = Array.isArray(source.values) ? source.values : [];
      const next = [...current];
      for (const v of ['roaring', 'bolagsverket']) {
        if (!next.includes(v)) next.push(v);
      }
      source.values = next;
    }

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('startup_financials');
    for (const name of ['balance_sheet_sek', 'equity_sek', 'net_result_sek']) {
      const f = col.fields.getByName(name);
      if (f) col.fields.remove(f);
    }
    const source = col.fields.getByName('source');
    if (source && Array.isArray(source.values)) {
      source.values = source.values.filter((v) => v !== 'roaring' && v !== 'bolagsverket');
    }
    app.save(col);
  }
);
