/// <reference path="../pb_data/types.d.ts" />

// Excel-arket "IPR" — immateriella rättigheter (patent, varumärken m.fl.)
// per bolag. Spårar ansökningsprocessen från idé → beslut.
//
// CLAUDE.md § 9.3: typ + status + datum är AI-säkert. `external_reference`
// (t.ex. patent-nummer från PRV/EPO) är publik företagsinformation. `notes`
// kan innehålla strategiska detaljer → exkluderas från default-whitelist.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'intellectual_property_collection',
      name: 'intellectual_property',
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
        // Excel: "Typ"
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'patent',
            'utility_model',
            'trademark',
            'design',
            'copyright',
            'trade_secret',
            'domain',
            'other'
          ]
        },
        // Excel: "Status"
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'idea',
            'filed',
            'pending',
            'granted',
            'rejected',
            'abandoned',
            'expired'
          ]
        },
        // Excel: "Ext. referens" — patent-/varumärkesnummer hos PRV, EPO,
        // EUIPO etc. Frisktext.
        { name: 'external_reference', type: 'text', required: false, max: 200 },
        // Excel: "Ansökningsdatum"
        { name: 'filed_at', type: 'date', required: false },
        // Excel: "Svarsdatum" — beslut/respons från myndighet.
        { name: 'response_at', type: 'date', required: false },
        // Excel: "Anteckning"
        { name: 'notes', type: 'editor', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_ipr_tenant ON intellectual_property (tenant)',
        'CREATE INDEX idx_ipr_startup ON intellectual_property (startup)',
        'CREATE INDEX idx_ipr_status ON intellectual_property (status)',
        'CREATE INDEX idx_ipr_type ON intellectual_property (type)'
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
      app.delete(app.findCollectionByNameOrId('intellectual_property'));
    } catch (e) {
      /* ignore */
    }
  }
);
