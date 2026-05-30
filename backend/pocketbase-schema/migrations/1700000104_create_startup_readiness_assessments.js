/// <reference path="../pb_data/types.d.ts" />

// startup_readiness_assessments — Vinnovas fyra readiness-axlar enligt
// KTH:s Innovation Readiness Level (IRL), skala 1–9:
//   CRL  = Customer Readiness Level
//   TMRL = Team Readiness Level
//   BRL  = Business Readiness Level
//   SRL  = Sustainability Readiness Level
//
// En rad per bedömningstillfälle (tidsserie) → rapporten plockar senaste
// värdet per bolag, och vi kan visa progression över tid. Ersätter inte
// startups.irl_level (sammanfattande tal) utan kompletterar det med de fyra
// axlar Vinnovas lägesredovisning kräver. criteria_checked_at = "datum då
// inkubatorn senast kontrollerat målgruppskriterier".
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md.
//
// Bolagsbedömning (ej individ) → riskklass minimal/begränsad. Får
// whitelistas till AI-kontext (jfr irl_level).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const usersCol = app.findCollectionByNameOrId('users');

    const rl = (name) => ({ name, type: 'number', required: false, min: 1, max: 9 });

    const collection = new Collection({
      id: 'startup_readiness_assess_col',
      name: 'startup_readiness_assessments',
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
        { name: 'assessed_at', type: 'date', required: true },
        rl('crl'),
        rl('tmrl'),
        rl('brl'),
        rl('srl'),
        { name: 'criteria_checked_at', type: 'date', required: false },
        {
          name: 'assessed_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { name: 'note', type: 'text', required: false, max: 1000 }
      ],
      indexes: [
        'CREATE INDEX idx_readiness_tenant ON startup_readiness_assessments (tenant)',
        'CREATE INDEX idx_readiness_startup ON startup_readiness_assessments (startup)',
        'CREATE INDEX idx_readiness_assessed ON startup_readiness_assessments (assessed_at)'
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
      app.delete(app.findCollectionByNameOrId('startup_readiness_assessments'));
    } catch (e) {
      /* ignore */
    }
  }
);
