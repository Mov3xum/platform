/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 51.5 — Bedömning excellens: manuell komplettering + utdelning.
//
// 1. `startups.excellence_review` (json): controllerns manuella uppgifter för
//    de punkter bolagsregistret/plattformen inte kan avgöra (börsnotering,
//    vinstutdelning, företagskoncentration, övertagen verksamhet, fristående
//    när aktieboken krävs, de minimis-intyg, grundarnas engagemang + mognads-
//    fas, innovationshöjd, övriga villkor, excellens). Formen tolkas tolerant
//    av `normalizeExcellenceManualReview` i @platform/shared (ren,
//    enhetstestad): { checks: { <nyckel>: { verdict, note, updated_at } },
//    engagement: { phase, founders: [{ name, pct }] } }. Systemet vinner
//    alltid — en sparad uppgift för en punkt registret numera besvarar
//    ignoreras. Noter personnummer-saneras på skrivvägen; UI:t säger "inga
//    personuppgifter". Skrivs bara av staff via server-action (RBAC + tenant),
//    aldrig av chatt-agenten (`update_startup_field`-whitelisten omfattar
//    inte fältet).
//
// 2. `startup_financials.dividend_sek` (number): beslutad/utbetald utdelning
//    enligt bokslutet när bolagsregistret (Roaring) ger uppgiften — en
//    utdelning i något bokslut avgör grundförutsättningen "har inte delat ut
//    vinst" (NEJ) i art. 22-screeningen. Saknat värde = okänt, aldrig 0.
//    Publik årsredovisningsdata — ingen PII.
//
// Speglas i setup-via-api.mjs (patchCollection) och asserteras i
// verify-baseline.mjs (REQUIRED_APP_FIELDS), eftersom PB släpper okända fält
// tyst (§ 24.4). Riskklass n/a (ingen AI).

migrate(
  (app) => {
    const startups = app.findCollectionByNameOrId('startups');
    if (!startups.fields.getByName('excellence_review')) {
      startups.fields.add(
        new Field({
          name: 'excellence_review',
          type: 'json',
          required: false,
          maxSize: 20000
        })
      );
      app.save(startups);
    }

    const fin = app.findCollectionByNameOrId('startup_financials');
    if (!fin.fields.getByName('dividend_sek')) {
      fin.fields.add(new Field({ name: 'dividend_sek', type: 'number', required: false }));
      app.save(fin);
    }
  },
  (app) => {
    const startups = app.findCollectionByNameOrId('startups');
    if (startups.fields.getByName('excellence_review')) {
      startups.fields.removeByName('excellence_review');
      app.save(startups);
    }
    const fin = app.findCollectionByNameOrId('startup_financials');
    if (fin.fields.getByName('dividend_sek')) {
      fin.fields.removeByName('dividend_sek');
      app.save(fin);
    }
  }
);
