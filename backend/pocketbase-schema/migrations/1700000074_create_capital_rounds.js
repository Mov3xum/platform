/// <reference path="../pb_data/types.d.ts" />

// Excel-arket "Kapital" — varje rad är faktiskt MOTTAGET kapital
// (utbetalad runda, bidrag, lån). Skiljer sig från:
//   • `deals`               — pipeline mot investerare (intro → close)
//   • `partner_engagements` — generella partnerskap (mentorship, pilot)
//
// `capital_rounds` är audit-trail av historiskt mottaget kapital som
// AI-agenter (t.ex. quarterly report, portfolio overview) kan resonera
// kring utan att exponera deal-pipeline.
//
// CLAUDE.md § 9.3: belopp + finansiärsnamn + datum + typ är AI-säkert
// (företagsinformation, inte PII). `notes` är fri editor — staff bör
// undvika PII där, men fältet finns för internt bruk och INKLUDERAS INTE
// i AI-kontextens default-whitelist (defense-in-depth).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'capital_rounds_collection',
      name: 'capital_rounds',
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
        // Excel: "Typ" — kapitaltyp.
        // grant=bidrag, equity=ägarkapital, loan=lån,
        // soft_funding=mjukt kapital (innovationscheck, ALMI),
        // convertible=konvertibelt skuldebrev, other=övrigt.
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['grant', 'equity', 'loan', 'soft_funding', 'convertible', 'other']
        },
        // Excel: "Finansiär" — frisktext (t.ex. "Vinnova", "Almi",
        // "Norrsken VC"). Kopplas inte hårt till `investors` eftersom
        // bidragsgivare ofta ej har deal-pipeline.
        { name: 'source', type: 'text', required: true, max: 200 },
        // Excel: "Belopp" — SEK. Tillåt negativt? Nej, mottaget kapital.
        { name: 'amount_sek', type: 'number', required: true, min: 0 },
        // Excel: "Mottaget datum".
        { name: 'received_at', type: 'date', required: true },
        // Excel: "Anteckning".
        { name: 'notes', type: 'editor', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_capital_tenant ON capital_rounds (tenant)',
        'CREATE INDEX idx_capital_startup ON capital_rounds (startup)',
        'CREATE INDEX idx_capital_received ON capital_rounds (received_at)',
        'CREATE INDEX idx_capital_type ON capital_rounds (type)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('capital_rounds'));
    } catch (e) {
      /* ignore */
    }
  }
);
