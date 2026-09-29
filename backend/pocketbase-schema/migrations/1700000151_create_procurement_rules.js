/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39 — Uppföljningsregler för upphandlingar. En regel säger:
// "<offset_days> dagar från <anchor> ska en uppgift '<task_title>' finnas,
// <repeat>, så länge <condition> gäller". Reglerna expanderas deterministiskt
// till `tasks` av `planProcurementFollowups` (@platform/shared, enhetstestad)
// — ingen AI-inferens. Standardreglerna (`DEFAULT_PROCUREMENT_RULES`)
// materialiseras lazy per tenant av appen första gången modulen öppnas, så
// nya tenants får dem utan ny migration.
//
// RLS: list/view staff/observer; update/delete admin/incubator_lead (samma
// krets som schemaläggning av agenter, § 12). createRule roll-lös (§ 21.3).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const procurementsCol = app.findCollectionByNameOrId('procurements');

    const collection = new Collection({
      id: 'procurement_rules_collection',
      name: 'procurement_rules',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'name', type: 'text', required: true, min: 1, max: 120 },
        // Tom = gäller alla upphandlingar i tenanten; satt = BARA denna
        // (regler som lästs ut ur ett specifikt underlag). cascadeDelete:
        // raderas upphandlingen försvinner dess egna regler.
        {
          name: 'procurement',
          type: 'relation',
          required: false,
          collectionId: procurementsCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        // Select-värdena nedan MÅSTE spegla PROCUREMENT_RULE_* i
        // packages/shared/src/procurement.ts.
        { name: 'scope', type: 'select', required: true, maxSelect: 1, values: ['procurement', 'calloff'] },
        {
          name: 'anchor',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'tender_deadline',
            'contract_start',
            'contract_end',
            'calloff_start',
            'calloff_end',
            'milestone_1_due',
            'milestone_2_due',
            'milestone_1_approved',
            'milestone_2_approved'
          ]
        },
        { name: 'offset_days', type: 'number', required: false, onlyInt: true, min: -730, max: 730 },
        { name: 'repeat', type: 'select', required: true, maxSelect: 1, values: ['once', 'monthly', 'quarterly'] },
        {
          name: 'condition',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'always',
            'milestone_1_pending',
            'milestone_2_pending',
            'final_report_missing',
            'not_evaluated',
            'tender_not_awarded'
          ]
        },
        { name: 'applies_to', type: 'select', required: true, maxSelect: 1, values: ['all', 'excellence'] },
        { name: 'task_title', type: 'text', required: true, min: 1, max: 300 },
        {
          name: 'task_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['followup', 'meeting', 'admin', 'email', 'call', 'prep', 'other']
        },
        { name: 'active', type: 'bool', required: false },
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
        'CREATE INDEX idx_procurement_rules_tenant ON procurement_rules (tenant)',
        'CREATE INDEX idx_procurement_rules_procurement ON procurement_rules (procurement)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('procurement_rules'));
    } catch (e) {
      /* ignore */
    }
  }
);
