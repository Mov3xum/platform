/// <reference path="../pb_data/types.d.ts" />

// service_time_entries — loggad tid per bolag och insats. Grunden för
// kolumnen "Periodens utfall för levererade inkubatortjänster (SEK)" i
// Vinnovas lägesredovisning: värde = hours × hourly_rate_sek.
//
// Timpriset anges per post (varierar per bolag/insats); saknas det faller
// resolver-lagret tillbaka på tenants.default_hourly_rate_sek (641 kr i
// underlaget). Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md.
//
// activity_kind:
//   - incubation   → inkubatortjänster (internt levererad tid)
//   - verification → verifieringstid (om tid bokförs som verifiering)
//   - admin        → ej Vinnova-rapporterbar overhead
//
// RBAC speglar startup_financials (1700000059): staff skriver, alla i
// tenanten läser, admin raderar. Affärsdata, ej PII — user-relationen
// aggregeras i rapporten, exponeras aldrig per individ i AI-kontext.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'service_time_entries_col',
      name: 'service_time_entries',
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
          name: 'user',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        {
          name: 'activity_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['incubation', 'verification', 'admin']
        },
        { name: 'hours', type: 'number', required: true, min: 0, max: 100000 },
        { name: 'hourly_rate_sek', type: 'number', required: false, min: 0, max: 100000 },
        { name: 'occurred_on', type: 'date', required: true },
        { name: 'note', type: 'text', required: false, max: 500 },
        {
          name: 'source',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['manual', 'import_excel', 'task_rollup', 'other']
        }
      ],
      indexes: [
        'CREATE INDEX idx_time_entries_tenant ON service_time_entries (tenant)',
        'CREATE INDEX idx_time_entries_startup ON service_time_entries (startup)',
        'CREATE INDEX idx_time_entries_occurred ON service_time_entries (occurred_on)'
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
      app.delete(app.findCollectionByNameOrId('service_time_entries'));
    } catch (e) {
      /* ignore */
    }
  }
);
