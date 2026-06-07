/// <reference path="../pb_data/types.d.ts" />

// De minimis-modul: `de_minimis_stod` — en rad per mottaget de minimis-stöd
// (per beslut/stödgivare), knutet till en enhet (`de_minimis_units`).
//
// Beräkning: stödet räknas från `beslutsdatum` (då den juridiska rätten
// uppstod, ej utbetalningsdatum). `belopp_eur` är sanning
// (bruttobidragsekvivalent); SEK + ECB-kurs lagras informativt. Summeringen
// (rullande 3 år resp. 3 beskattningsår) görs i packages/shared/src/
// de-minimis.ts och i UI/PDF — inte i DB.
//
// `registrerad_i_eair` förbereder framtida koppling mot eAir (Tillväxtanalys,
// gäller stöd fr.o.m. 2026-01-01, kontroll fr.o.m. 2029). `startup` är
// denormaliserad (= unitens startup) för tenant-/bolagsfiltrering och
// cascadeDelete när bolaget tas bort.
//
// GDPR: belopp + stödgivare + datum + referens är företagsinformation, inte
// PII. `syfte`/`beslut_referens` är frisktext — INKLUDERAS INTE i AI-kontext
// (defense-in-depth). Riskklass (EU AI Act): minimal — register/beräkning.
// RBAC speglar `de_minimis_units` (staff-only rule + server-action-fallback
// för länkad bolagsmedlem).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const unitsCol = app.findCollectionByNameOrId('de_minimis_units');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'de_minimis_stod_collection',
      name: 'de_minimis_stod',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'unit',
          type: 'relation',
          required: true,
          collectionId: unitsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'forordning',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE']
        },
        { name: 'stodgivare', type: 'text', required: true, max: 200 },
        // Den juridiska rätten uppstod (ej utbetalningsdatum).
        { name: 'beslutsdatum', type: 'date', required: true },
        // Bruttobidragsekvivalent i EUR — sanning.
        { name: 'belopp_eur', type: 'number', required: true, min: 0 },
        // Informativt: belopp i SEK + ECB-kurs på beslutsdatum.
        { name: 'belopp_sek', type: 'number', required: false, min: 0 },
        { name: 'valutakurs', type: 'number', required: false, min: 0 },
        { name: 'syfte', type: 'text', required: false, max: 500 },
        // Diarienummer/beslutsnr.
        { name: 'beslut_referens', type: 'text', required: false, max: 200 },
        // Uppladdat beslut (valfritt).
        {
          name: 'dokument',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 15728640, // 15 MB
          mimeTypes: [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/webp',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ],
          thumbs: []
        },
        { name: 'registrerad_i_eair', type: 'bool', required: false },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_de_minimis_stod_tenant ON de_minimis_stod (tenant)',
        'CREATE INDEX idx_de_minimis_stod_startup ON de_minimis_stod (startup)',
        'CREATE INDEX idx_de_minimis_stod_unit ON de_minimis_stod (unit)',
        'CREATE INDEX idx_de_minimis_stod_lookup ON de_minimis_stod (unit, forordning, beslutsdatum)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('de_minimis_stod'));
    } catch (e) {
      /* ignore */
    }
  }
);
