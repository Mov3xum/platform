/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 51.4 — `startups.screening_facts` (json): controllerns MANUELLA
// svar i Bedömning excellens, det som inget bolagsregister kan svara på:
// börsnotering, företagskoncentration, övertagen verksamhet (per bolag i
// koncernen), grundarteam med engagemang i % av heltid + mognadsfas,
// innovationshöjd/övriga villkor/marknadsredo, de minimis-intyg för anknutna
// bolag, IRL-nivåer och motivering per axel samt review-radens kommentar.
// Sparas per portföljbolag så nästa körning återanvänder svaren; skrivs in i
// PDF:n med källa "Manuell kontroll".
//
// Format tolkas tolerant av packages/shared/src/excellence-facts.ts
// (`normalizeScreeningFacts`, ren + enhetstestad) — okända nycklar/värden
// släpps, fritext personnummer-saneras och cappas på skrivvägen.
//
// GDPR § 5: fältet kan bära grundarnas namn + ägarandel + engagemang (samma
// krets som teamet på bolagskortet, berättigat intresse: statsstödskontroll)
// och fri motiveringstext. Fältet är därför FÄLTMASKAT i lib/ai/redaction.ts
// (når aldrig query_collection) och whitelistas inte i lib/ai/context.ts.
// Bara människor skriver det (writable-fields: agent deny). Riskklass n/a.
// Speglas i setup-via-api.mjs (patchCollection) och asserteras i
// verify-baseline.mjs (REQUIRED_APP_FIELDS) eftersom PB släpper okända fält
// tyst (§ 24.4).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('startups');
    if (!col.fields.getByName('screening_facts')) {
      col.fields.add(new Field({ name: 'screening_facts', type: 'json', required: false, maxSize: 60000 }));
      app.save(col);
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('startups');
    const f = col.fields.getByName('screening_facts');
    if (f) {
      col.fields.removeById(f.id);
      app.save(col);
    }
  }
);
