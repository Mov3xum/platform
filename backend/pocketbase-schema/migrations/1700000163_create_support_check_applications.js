/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46 — Ansökan om stödcheck. ENDA SANNINGEN för ett ärende: allt
// annat (de minimis-post, kapitalrad, uppföljningsuppgifter, aktivitetsrad)
// länkar hit. Digitaliserar mallen "Aktivitetsplan & ansökan":
//   - `activities` json: 1–n insatser (vad/mål/tidplan, deltagare, kostnad,
//     spetskompetens) — `participants` är PII (personnamn) och når ALDRIG
//     AI-kontexten (kollektionen är denylistad i lib/ai/redaction.ts).
//   - intyg/signering bor i den oföränderliga `support_check_revisions`
//     (1700000164); här ligger bara aktuell revision (`revision`).
//   - utlåtanden (coach/controller), bedömning (viktade kriterier 0–5),
//     FINANSIERING (projekt + arbetspaket + statsstödsgrund — sätts av
//     admin/incubator_lead), beslut, utbetalning, slutrapport.
// Statusmaskinen (SUPPORT_CHECK_STATUSES) lever i @platform/shared och
// enforce:as i skrivlagret.
//
// RLS (§ 21): medlem-scopad — bolaget ser SINA ansökningar
// (`linked_startups:each ?= startup`), staff/observer hela tenanten.
// createRule roll-lös (§ 21.3): bolagsmedlem OCH staff får skapa — behörighet
// (länkat bolag) enforce:as i skrivlagret. update: staff eller länkad medlem
// (skrivlagret begränsar medlemmen till utkast/komplettering). delete
// admin/incubator_lead. Autodate explicit (§ 28.5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const MEMBER = '@request.auth.linked_startups:each ?= startup';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const typesCol = app.findCollectionByNameOrId('support_check_types');
    const projectsCol = app.findCollectionByNameOrId('funding_projects');
    const workPackagesCol = app.findCollectionByNameOrId('funding_work_packages');
    const deMinimisCol = app.findCollectionByNameOrId('de_minimis_stod');
    const capitalCol = app.findCollectionByNameOrId('capital_rounds');

    const userRel = (name) => ({
      name,
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });

    const collection = new Collection({
      id: 'support_check_applications_collection',
      name: 'support_check_applications',
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
          name: 'check_type',
          type: 'relation',
          required: true,
          collectionId: typesCol.id,
          cascadeDelete: true,
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
        { name: 'title', type: 'text', required: false, max: 200 },
        // MÅSTE spegla SUPPORT_CHECK_STATUSES i packages/shared/src/support-checks.ts.
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'submitted', 'changes_requested', 'under_review', 'approved', 'rejected', 'paid', 'closed', 'withdrawn']
        },
        // SupportCheckActivity[] (insatser i prioriteringsordning).
        { name: 'activities', type: 'json', required: false, maxSize: 60000 },
        { name: 'requested_amount_sek', type: 'number', required: false, min: 0 },
        { name: 'approved_amount_sek', type: 'number', required: false, min: 0 },
        { name: 'activity_end_date', type: 'date', required: false },
        // Bolagets följebrev / hur resurser avsätts (mallens inledning).
        { name: 'applicant_note', type: 'text', required: false, max: 5000 },
        { name: 'revision', type: 'number', required: false, onlyInt: true, min: 0 },
        { name: 'submitted_at', type: 'date', required: false },
        userRel('submitted_by'),
        { name: 'changes_requested_at', type: 'date', required: false },
        { name: 'changes_due_at', type: 'date', required: false },
        { name: 'changes_request_note', type: 'text', required: false, max: 4000 },
        userRel('changes_requested_by'),
        // Utlåtanden (mallens "Ansvarig affärscoach utlåtande" / "Controllers utlåtande").
        { name: 'coach_statement', type: 'text', required: false, max: 8000 },
        userRel('coach_statement_by'),
        { name: 'coach_statement_at', type: 'date', required: false },
        { name: 'controller_statement', type: 'text', required: false, max: 8000 },
        userRel('controller_statement_by'),
        { name: 'controller_statement_at', type: 'date', required: false },
        // Bedömning: { [criterionKey]: 0–5 } + viktat betyg.
        { name: 'assessment_scores', type: 'json', required: false, maxSize: 20000 },
        { name: 'assessment_score', type: 'number', required: false, min: 0, max: 5 },
        userRel('assessed_by'),
        { name: 'assessed_at', type: 'date', required: false },
        // Finansiering — sätts av admin/incubator_lead, låses vid utbetalning.
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
          name: 'funding_work_package',
          type: 'relation',
          required: false,
          collectionId: workPackagesCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        // MÅSTE spegla STATE_AID_BASES (packages/shared/src/funding.ts).
        { name: 'state_aid_basis', type: 'select', required: false, maxSelect: 1, values: ['de_minimis', 'art22', 'none'] },
        { name: 'funding_note', type: 'text', required: false, max: 2000 },
        userRel('funding_set_by'),
        { name: 'funding_set_at', type: 'date', required: false },
        // Beslut (beslutsgruppen) — "Förslag till beslut och kort motivering".
        { name: 'decision_note', type: 'text', required: false, max: 4000 },
        userRel('decided_by'),
        { name: 'decided_at', type: 'date', required: false },
        { name: 'paid_at', type: 'date', required: false },
        { name: 'paid_amount_sek', type: 'number', required: false, min: 0 },
        { name: 'paid_note', type: 'text', required: false, max: 1000 },
        { name: 'final_report_received_at', type: 'date', required: false },
        { name: 'report_due_at', type: 'date', required: false },
        { name: 'closed_at', type: 'date', required: false },
        // Spåren som beslutet skapar — länkar, aldrig kopior av beloppen.
        {
          name: 'de_minimis_stod',
          type: 'relation',
          required: false,
          collectionId: deMinimisCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'capital_round',
          type: 'relation',
          required: false,
          collectionId: capitalCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'is_excellence_activity', type: 'bool', required: false },
        userRel('created_by')
      ],
      indexes: [
        'CREATE INDEX idx_support_check_applications_tenant ON support_check_applications (tenant)',
        'CREATE INDEX idx_support_check_applications_startup ON support_check_applications (startup)',
        'CREATE INDEX idx_support_check_applications_type ON support_check_applications (check_type)',
        'CREATE INDEX idx_support_check_applications_tenant_status ON support_check_applications (tenant, status)',
        'CREATE INDEX idx_support_check_applications_project ON support_check_applications (funding_project)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || ${MEMBER})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('support_check_applications'));
    } catch (e) {
      /* ignore */
    }
  }
);
