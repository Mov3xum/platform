/// <reference path="../pb_data/types.d.ts" />

// KTH Innovation Readiness Level™ på bolagskortet (2026-10). Migration
// 1700000104 skapade `startup_readiness_assessments` med Vinnovas fyra axlar
// (crl, tmrl, brl, srl). KTH:s IRL har sex axlar — här läggs de tre som
// saknas till: trl (teknik), iprl (immateriella rättigheter) och frl
// (finansiering), samt `axis_notes` (json) = coachens motivering per axel.
// En rad per bedömningstillfälle (tidsserie) som förut; srl ligger kvar som
// Vinnovas tillägg. Axlarna, nivåbeskrivningarna och valideringen bor i
// packages/shared/src/kth-irl.ts.
//
// Bolagsbedömning, ingen individbedömning → ingen PII i talen. axis_notes är
// coachens fritext — personnummer saneras på skrivvägen och UI:t uppmanar
// att inte skriva personuppgifter. Kollektionens RLS (staff/observer-only,
// migration 1700000112) är oförändrad. Riskklass n/a (ingen AI-inferens).
// Speglas i setup-via-api.mjs och asserteras i verify-baseline.mjs
// (REQUIRED_APP_FIELDS) eftersom PB släpper okända fält tyst (§ 24.4).

const LEVEL_FIELDS = ['trl', 'iprl', 'frl'];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('startup_readiness_assessments');
    let changed = false;
    for (const name of LEVEL_FIELDS) {
      if (!col.fields.getByName(name)) {
        col.fields.add(new Field({ name, type: 'number', required: false, min: 1, max: 9, onlyInt: true }));
        changed = true;
      }
    }
    if (!col.fields.getByName('axis_notes')) {
      col.fields.add(new Field({ name: 'axis_notes', type: 'json', required: false, maxSize: 20000 }));
      changed = true;
    }
    if (changed) app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('startup_readiness_assessments');
    for (const name of [...LEVEL_FIELDS, 'axis_notes']) {
      const f = col.fields.getByName(name);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
