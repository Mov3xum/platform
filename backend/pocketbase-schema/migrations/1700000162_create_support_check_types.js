/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46 — Checktyper (excellenscheck, resecheck, AI-verktygscheck …).
// En checktyp är KONFIGURATION: vad bolaget kan söka, tak per check,
// behörighetskrav (obligatorisk workshop, minsta IRL-nivå), bedömningskriterier,
// krav på slutrapport och defaults för finansieringen (projekt/arbetspaket/
// statsstödsgrund) som admin sätter per ansökan.
//
// RLS: list/view = ALLA inloggade i tenanten — en bolagsmedlem måste kunna se
// vilka checkar som finns för att kunna ansöka (typen bär ingen PII och inga
// beslut; interna kriterier/projekt är konfiguration, inte bolagsdata).
// createRule roll-lös (§ 21.3); update/delete admin/incubator_lead.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const workshopsCol = app.findCollectionByNameOrId('workshops');
    const projectsCol = app.findCollectionByNameOrId('funding_projects');
    const workPackagesCol = app.findCollectionByNameOrId('funding_work_packages');

    const collection = new Collection({
      id: 'support_check_types_collection',
      name: 'support_check_types',
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
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        // MÅSTE spegla SUPPORT_CHECK_KINDS i packages/shared/src/support-checks.ts.
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['excellence', 'travel', 'internationalization', 'ai_tools', 'other']
        },
        // Text som visas för bolaget i ansökningsformuläret (vad checken är, vad som krävs).
        { name: 'description', type: 'text', required: false, max: 5000 },
        { name: 'active', type: 'bool', required: false },
        { name: 'max_amount_sek', type: 'number', required: false, min: 0 },
        {
          name: 'funding_project',
          type: 'relation',
          required: false,
          collectionId: projectsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'default_work_package',
          type: 'relation',
          required: false,
          collectionId: workPackagesCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        // MÅSTE spegla STATE_AID_BASES (packages/shared/src/funding.ts).
        { name: 'default_state_aid_basis', type: 'select', required: false, maxSelect: 1, values: ['de_minimis', 'art22', 'none'] },
        {
          name: 'requires_workshop',
          type: 'relation',
          required: false,
          collectionId: workshopsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'min_irl_level', type: 'number', required: false, onlyInt: true, min: 0, max: 9 },
        { name: 'requires_final_report', type: 'bool', required: false },
        { name: 'report_due_days', type: 'number', required: false, onlyInt: true, min: 0, max: 365 },
        { name: 'changes_due_days', type: 'number', required: false, onlyInt: true, min: 1, max: 180 },
        { name: 'is_excellence_activity', type: 'bool', required: false },
        // SupportCheckCriterion[] — viktade bedömningskriterier (0–5).
        { name: 'criteria', type: 'json', required: false, maxSize: 20000 },
        { name: 'opens_at', type: 'date', required: false },
        { name: 'closes_at', type: 'date', required: false },
        { name: 'sort_order', type: 'number', required: false, onlyInt: true },
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
        'CREATE INDEX idx_support_check_types_tenant ON support_check_types (tenant)',
        'CREATE INDEX idx_support_check_types_tenant_active ON support_check_types (tenant, active)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('support_check_types'));
    } catch (e) {
      /* ignore */
    }
  }
);
