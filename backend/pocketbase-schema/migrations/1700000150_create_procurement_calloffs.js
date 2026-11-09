/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39 — Avrop per inkubatorbolag under en upphandling. Bär de två
// milstolparna ur upphandlingsbeskrivningen (M1 "processen fungerar" senast
// 8 veckor från avropsstart, M2 "teamet kör själva" inom coachningsperioden),
// slutrapport, belopp/betalningsandel, statsstödsflagga och leverantörs-
// utvärderingen (viktad 0–5 mot upphandlingens kriterier). Fasen härleds av
// klockan i `calloffPhase` (@platform/shared) — statusfältet är människans ord.
//
// RLS/PII: som `procurements` (1700000149). Evaluation-texter är fritext om
// leverantörens leverans, aldrig om enskilda personer (UI:t uppmanar).

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
    const startupsCol = app.findCollectionByNameOrId('startups');
    const procurementsCol = app.findCollectionByNameOrId('procurements');

    const collection = new Collection({
      id: 'procurement_calloffs_collection',
      name: 'procurement_calloffs',
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
        {
          name: 'procurement',
          type: 'relation',
          required: true,
          collectionId: procurementsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: false, max: 200 },
        // MÅSTE spegla CALLOFF_STATUSES i packages/shared/src/procurement.ts.
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planned', 'active', 'completed', 'cancelled']
        },
        { name: 'started_at', type: 'date', required: false },
        { name: 'ends_at', type: 'date', required: false },
        { name: 'milestone_1_due', type: 'date', required: false },
        { name: 'milestone_1_approved_at', type: 'date', required: false },
        { name: 'milestone_2_due', type: 'date', required: false },
        { name: 'milestone_2_approved_at', type: 'date', required: false },
        { name: 'final_report_received_at', type: 'date', required: false },
        { name: 'amount_sek', type: 'number', required: false, min: 0 },
        { name: 'movexum_share_pct', type: 'number', required: false, min: 0, max: 100 },
        { name: 'state_aid_relevant', type: 'bool', required: false },
        { name: 'is_excellence_activity', type: 'bool', required: false },
        // { [criterionKey]: 0–5 }
        { name: 'evaluation_scores', type: 'json', required: false, maxSize: 20000 },
        { name: 'evaluation_score', type: 'number', required: false, min: 0, max: 5 },
        { name: 'evaluation_summary', type: 'text', required: false, max: 5000 },
        { name: 'evaluated_at', type: 'date', required: false },
        {
          name: 'evaluated_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'notes', type: 'text', required: false, max: 5000 },
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
        'CREATE INDEX idx_procurement_calloffs_tenant ON procurement_calloffs (tenant)',
        'CREATE INDEX idx_procurement_calloffs_procurement ON procurement_calloffs (procurement)',
        'CREATE INDEX idx_procurement_calloffs_startup ON procurement_calloffs (startup)'
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
      app.delete(app.findCollectionByNameOrId('procurement_calloffs'));
    } catch (e) {
      /* ignore */
    }
  }
);
