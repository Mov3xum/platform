/// <reference path="../pb_data/types.d.ts" />

// De minimis-modul: "ett enda företag" (single undertaking).
//
// Treårssumman beräknas inte per juridisk person utan per ett enda företag —
// koncernen av sammanlänkade enheter (majoritet av röster, rätt att utse
// ledning, bestämmande inflytande). `de_minimis_units` grupperar därför ett
// eller flera org.nr (`de_minimis_unit_orgnr`) under en bolagsprofil
// (`startup`), och summeringen sker på enhetsnivå.
//
// Scope: tenant-isolerad. Skrivning är staff-only på rule-nivå (auth-only
// rule, ingen `= tenant`-join → undviker PB v0.23 rule-eval-buggen, se
// verify-baseline.mjs); bolagsmedlemmens egna skrivningar går via server
// action med superuser-fallback efter verifierad länkning (samma mönster som
// education_documents / workshop-progress, CLAUDE.md § 9.5 / § 18.3).
//
// GDPR: för aktiebolag är org-nr inte personuppgift (skäl 14). För enskild
// firma motsvarar org-nr personnummer → exkluderas alltid från AI-kontext
// (CLAUDE.md § 9.3). Inga av dessa fält whitelistas för AI.
// Riskklass (EU AI Act): minimal — register/beräkning, ingen AI-inferens.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const usersCol = app.findCollectionByNameOrId('users');

    const units = new Collection({
      id: 'de_minimis_units_collection',
      name: 'de_minimis_units',
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
        { name: 'namn', type: 'text', required: true, max: 200 },
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
        'CREATE INDEX idx_de_minimis_units_tenant ON de_minimis_units (tenant)',
        'CREATE INDEX idx_de_minimis_units_startup ON de_minimis_units (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(units);

    const orgnr = new Collection({
      id: 'de_minimis_unit_orgnr_collection',
      name: 'de_minimis_unit_orgnr',
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
          name: 'unit',
          type: 'relation',
          required: true,
          collectionId: units.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'organisationsnummer', type: 'text', required: true, max: 32 }
      ],
      indexes: [
        'CREATE INDEX idx_de_minimis_orgnr_tenant ON de_minimis_unit_orgnr (tenant)',
        'CREATE INDEX idx_de_minimis_orgnr_unit ON de_minimis_unit_orgnr (unit)',
        'CREATE UNIQUE INDEX idx_de_minimis_orgnr_unique ON de_minimis_unit_orgnr (unit, organisationsnummer)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(orgnr);
  },
  (app) => {
    for (const name of ['de_minimis_unit_orgnr', 'de_minimis_units']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
