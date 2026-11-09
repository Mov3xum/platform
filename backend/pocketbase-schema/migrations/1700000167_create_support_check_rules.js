/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.6 — Uppföljningsregler för stödcheckar. Samma kolumner som
// `procurement_rules` (§ 39.2) men egen kollektion (egna ankare/villkor, egen
// RLS-krets): "<offset_days> dagar från <anchor> ska en uppgift '<task_title>'
// finnas, <repeat>, så länge <condition> gäller". Expanderas till `tasks` av
// `planSupportCheckFollowups` (@platform/shared, enhetstestad) via den
// generiska motorn (§ 40) — ingen AI. Standardreglerna
// (DEFAULT_SUPPORT_CHECK_RULES: bedöm, controller, beslut, komplettering,
// utbetalning, slutrapport) materialiseras lazy per tenant.
//
// RLS: list/view staff/observer; update/delete admin/incubator_lead;
// createRule roll-lös (§ 21.3).

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
    const typesCol = app.findCollectionByNameOrId('support_check_types');

    const collection = new Collection({
      id: 'support_check_rules_collection',
      name: 'support_check_rules',
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
        // Tom = alla checktyper; satt = BARA denna.
        {
          name: 'check_type',
          type: 'relation',
          required: false,
          collectionId: typesCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        // Select-värdena MÅSTE spegla SUPPORT_CHECK_RULE_* i packages/shared/src/support-checks.ts.
        {
          name: 'anchor',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['submitted_at', 'changes_requested_at', 'decided_at', 'paid_at', 'activity_end']
        },
        { name: 'offset_days', type: 'number', required: false, onlyInt: true, min: -730, max: 730 },
        { name: 'repeat', type: 'select', required: true, maxSelect: 1, values: ['once', 'monthly', 'quarterly'] },
        {
          name: 'condition',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['always', 'awaiting_review', 'awaiting_controller', 'awaiting_decision', 'changes_pending', 'not_paid', 'report_missing']
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
        'CREATE INDEX idx_support_check_rules_tenant ON support_check_rules (tenant)',
        'CREATE INDEX idx_support_check_rules_type ON support_check_rules (check_type)'
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
      app.delete(app.findCollectionByNameOrId('support_check_rules'));
    } catch (e) {
      /* ignore */
    }
  }
);
