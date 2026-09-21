/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30). Movexums verksamhetsårshjul — en rad per
// återkommande aktivitet i året, kategoriserad som styrelse/ledning/gemensamt
// (hjulets legend + färg) och spår (tabellens kolumner: kampanjer,
// verksamhetsrapporter, projekt, team, ledningsgrupp, projektstyrgrupper).
// Styrs manuellt på /arshjul ELLER via dashboardchatten (delat skrivlager).
//
// Riskklass minimal: ingen AI-inferens, ingen PII (intern verksamhetsplanering).
// Tenant-bred STAFF/OBSERVER-data (§ 21): en ren startup_member ska INTE se
// Movexums interna styrelse-/ledningskalender → list/view kräver staff/observer.
// createRule refererar BARA auth-fält (ingen roll-check, ingen `= tenant`-join)
// för att undvika PB v0.23.4:s rule-eval-buggar (§ 21.3, verify-baseline-svepet);
// roll-enforcement görs i server-actions. update/delete behåller staff-check med
// `:each ?=` (multi-värde-operatorbuggen, § 21.3).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'annual_wheel_items_collection',
      name: 'annual_wheel_items',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'year', type: 'number', required: true, onlyInt: true, min: 2000, max: 2100 },
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        // 1–12, eller tomt (= helårs-/kvartalsövergripande aktivitet).
        { name: 'month', type: 'number', required: false, onlyInt: true, min: 1, max: 12 },
        {
          name: 'track',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'kampanjer',
            'verksamhetsrapporter',
            'projekt',
            'team',
            'ledningsgrupp',
            'projektstyrgrupper',
            'ovrigt'
          ]
        },
        {
          name: 'category',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['styrelse', 'ledning', 'gemensamt']
        },
        { name: 'notes', type: 'text', required: false, max: 2000 },
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
        'CREATE INDEX idx_annual_wheel_items_tenant ON annual_wheel_items (tenant)',
        'CREATE INDEX idx_annual_wheel_items_tenant_year ON annual_wheel_items (tenant, year)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('annual_wheel_items'));
    } catch (e) {
      /* ignore */
    }
  }
);
