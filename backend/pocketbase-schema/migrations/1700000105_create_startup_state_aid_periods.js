/// <reference path="../pb_data/types.d.ts" />

// startup_state_aid_periods — statsstödsgrund som tidsserie. Vinnovas
// lägesredovisning kräver "en rad per deltagande AB så länge stödgrunden
// är samma; vid växling mellan Artikel 22 och Stöd av mindre betydelse
// läggs den nya grunden i en ny rad". Ett bolag kan alltså ge flera rader.
//
// basis:
//   - art22       → statsstöd enligt artikel 22 i GBER
//   - de_minimis  → stöd av mindre betydelse (kräver SNI-kod, e-AidRegister)
//
// sni_code anges per period (kan skilja sig från startups.sni_code om
// bolaget bytt verksamhet). valid_to tom = pågående.
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'startup_state_aid_periods_col',
      name: 'startup_state_aid_periods',
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
          name: 'basis',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['art22', 'de_minimis']
        },
        { name: 'sni_code', type: 'text', required: false, max: 20 },
        { name: 'valid_from', type: 'date', required: true },
        { name: 'valid_to', type: 'date', required: false },
        { name: 'note', type: 'text', required: false, max: 500 }
      ],
      indexes: [
        'CREATE INDEX idx_state_aid_tenant ON startup_state_aid_periods (tenant)',
        'CREATE INDEX idx_state_aid_startup ON startup_state_aid_periods (startup)',
        'CREATE INDEX idx_state_aid_from ON startup_state_aid_periods (valid_from)'
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
      app.delete(app.findCollectionByNameOrId('startup_state_aid_periods'));
    } catch (e) {
      /* ignore */
    }
  }
);
