/// <reference path="../pb_data/types.d.ts" />

// startup_service_costs — externa kostnader fördelade per bolag. Grunden
// för kolumnen "Periodens utfall för levererade verifieringstjänster (SEK)"
// i Vinnovas lägesredovisning. I underlaget = leverantörsfakturor (Rouse,
// PRV, Barzey Advokatbyrå, Lindahl, UC m.fl.) fördelade per bolag.
//
// cost_type:
//   - verification     → verifieringstjänster (IP-juridik, patentverk, …)
//   - external_service → övriga externa inkubatortjänster
//   - other            → ej Vinnova-rapporterbart
//
// source förbereder framtida bokföringsintegration (Fortnox/Visma via
// integrationsramverket § 11); `accounting` reserverat. amount_sek avser
// bolagets ANDEL av en (ev. fördelad) faktura.
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md.
//
// RBAC speglar startup_financials. notes kan vara strategiskt → exkluderas
// från AI-kontext (samma mönster som capital_rounds.notes).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'startup_service_costs_col',
      name: 'startup_service_costs',
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
          name: 'cost_type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['verification', 'external_service', 'other']
        },
        { name: 'supplier', type: 'text', required: false, max: 200 },
        { name: 'invoice_ref', type: 'text', required: false, max: 120 },
        { name: 'amount_sek', type: 'number', required: true, min: 0 },
        { name: 'incurred_on', type: 'date', required: true },
        { name: 'allocation_note', type: 'text', required: false, max: 500 },
        { name: 'notes', type: 'text', required: false, max: 1000 },
        {
          name: 'source',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['manual', 'import_excel', 'accounting', 'other']
        }
      ],
      indexes: [
        'CREATE INDEX idx_service_costs_tenant ON startup_service_costs (tenant)',
        'CREATE INDEX idx_service_costs_startup ON startup_service_costs (startup)',
        'CREATE INDEX idx_service_costs_incurred ON startup_service_costs (incurred_on)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('startup_service_costs'));
    } catch (e) {
      /* ignore */
    }
  }
);
