/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 11.8 / § 51 — `tenant_integrations.pricing` (json): vad
// leverantören (Roaring) debiterar per API-anrop och datadel, i credits, samt
// kronor per credit enligt tenantens avtal. Anges av ledningen under
// Inställningar → Integrationer → <leverantör> → Kostnad per anrop och visas
// vid varje hämtning (kryssrutorna, "Testa mot org-nr", portföljsynk,
// bolagskortet, Bedömning excellens) så controllern ser vad ett uppslag
// faktiskt kostar INNAN det görs och vad en gjord hämtning kostade.
//
// Format: { credits: { basic, financials, group_structure, beneficial_owners },
//           sek_per_credit, note, updated_at } — tolkas tolerant av
// apps/web/src/lib/integrations/company-registry/pricing.ts (ren,
// enhetstestad). Saknat fält = "pris ej angivet", aldrig en gissad siffra.
//
// GDPR: inga personuppgifter (prislista + fri notering som valideras mot
// personnummer-mönster). Inte en hemlighet — stripas INTE av
// strip_integration_config.pb.js (bara `config`). Riskklass n/a. Speglas i
// setup-via-api.mjs (patchCollection) och asserteras i verify-baseline.mjs
// (REQUIRED_APP_FIELDS).

migrate(
  (app) => {
    const ti = app.findCollectionByNameOrId('tenant_integrations');
    if (!ti.fields.getByName('pricing')) {
      ti.fields.add(
        new Field({
          name: 'pricing',
          type: 'json',
          required: false,
          maxSize: 4000
        })
      );
      app.save(ti);
    }
  },
  (app) => {
    const ti = app.findCollectionByNameOrId('tenant_integrations');
    const f = ti.fields.getByName('pricing');
    if (f) {
      ti.fields.removeByName('pricing');
      app.save(ti);
    }
  }
);
