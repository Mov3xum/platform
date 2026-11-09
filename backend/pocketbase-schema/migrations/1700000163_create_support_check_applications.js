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
// (länkat bolag) enforce:as i skrivlagret. Reglerna är dessutom FÄLTLÅSTA
// (`@request.body.<fält>:isset = false`) så att en användartoken via
// direkt-API aldrig når längre än rollen: bolagsmedlem/coach kan inte sätta
// finansiering, beslut eller utbetalning (ledningsfält), ingen icke-ledning
// kan byta tenant/bolag/checktyp/skapare, och medlemmens statusbyten är
// kopplade till nuvarande status (inskick bara från utkast/komplettering,
// återkallelse bara före beslut, slutrapport bara när utbetald). Ett create
// måste vara ett utkast i den inloggades eget namn. Skrivlagret är fortsatt den
// primära gränsen — detta är defense-in-depth. delete admin/incubator_lead.
// Autodate explicit (§ 28.5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const MEMBER = '@request.auth.linked_startups:each ?= startup';

// Fält som BARA ledningen (admin/incubator_lead) får skriva.
const LEAD_ONLY_FIELDS = [
  'funding_project',
  'funding_work_package',
  'state_aid_basis',
  'funding_note',
  'funding_set_by',
  'funding_set_at',
  'approved_amount_sek',
  'decision_note',
  'decided_by',
  'decided_at',
  'paid_at',
  'paid_amount_sek',
  'paid_note',
  'de_minimis_stod',
  'capital_round'
];
// Identitetsfält — sätts vid skapandet, ändras aldrig via API:t (ingen roll).
const IDENTITY_FIELDS = ['tenant', 'startup', 'check_type', 'created_by'];
// Granskningens fält — bolagsmedlemmen får aldrig skriva dem (inte heller vid create).
const REVIEW_FIELDS = [
  'changes_request_note',
  'changes_requested_by',
  'coach_statement',
  'coach_statement_by',
  'coach_statement_at',
  'controller_statement',
  'controller_statement_by',
  'controller_statement_at',
  'assessment_scores',
  'assessment_score',
  'assessed_by',
  'assessed_at',
  'is_excellence_activity',
  'report_due_at'
];
// Ansökans innehåll — låst för medlemmen utanför utkast/komplettering.
const CONTENT_FIELDS = ['title', 'activities', 'requested_amount_sek', 'activity_end_date', 'applicant_note'];
// Inskickets fält — medlemmen får bara sätta dem tillsammans med status → submitted.
const SUBMIT_FIELDS = ['revision', 'submitted_at', 'submitted_by'];
const unset = (fields) => `(${fields.map((f) => `@request.body.${f}:isset = false`).join(' && ')})`;
const LEAD_FIELDS_UNSET = unset(LEAD_ONLY_FIELDS);
const IDENTITY_UNSET = unset(IDENTITY_FIELDS);
const REVIEW_FIELDS_UNSET = unset(REVIEW_FIELDS);
const statusIn = (values) => `(@request.body.status:isset = false || ${values.map((v) => `@request.body.status = "${v}"`).join(' || ')})`;
// Staff (coach/mentor) får driva ärendet fram till beslut; beslut/utbetalning = ledning.
const STAFF_STATUS = statusIn(['draft', 'submitted', 'changes_requested', 'under_review', 'closed', 'withdrawn']);
// Medlemmen: målstatus är KOPPLAD till nuvarande status (samma övergångar
// som `canTransitionSupportCheck` för rollen applicant), och fälten som hör
// till respektive övergång får bara skrivas i just den:
//   utkast/komplettering → redigera innehåll, skicka in (revision/submitted_*)
//                          eller återkalla (closed_at);
//   inskickad/granskas   → bara återkalla;
//   utbetald             → bara slutrapport (final_report_received_at).
const MEMBER_EDIT = `(@request.body.status:isset = false && ${unset([...SUBMIT_FIELDS, 'closed_at', 'final_report_received_at'])})`;
const MEMBER_SUBMIT = `(@request.body.status = "submitted" && ${unset(['closed_at', 'final_report_received_at'])})`;
const MEMBER_WITHDRAW = `(@request.body.status = "withdrawn" && ${unset([...CONTENT_FIELDS, ...SUBMIT_FIELDS, 'final_report_received_at'])})`;
const MEMBER_REPORT = `(@request.body.status:isset = false && ${unset([...CONTENT_FIELDS, ...SUBMIT_FIELDS, 'closed_at'])})`;
const MEMBER_UPDATE =
  `(${MEMBER} && ${LEAD_FIELDS_UNSET} && ${IDENTITY_UNSET} && ${REVIEW_FIELDS_UNSET} && (` +
  `((status = "draft" || status = "changes_requested") && (${MEMBER_EDIT} || ${MEMBER_SUBMIT} || ${MEMBER_WITHDRAW})) || ` +
  `((status = "submitted" || status = "under_review") && ${MEMBER_WITHDRAW}) || ` +
  `(status = "paid" && ${MEMBER_REPORT})))`;
// Staff: aldrig ledningsfält, aldrig identitetsfält, bara staff-statusar.
const STAFF_UPDATE = `(${STAFF} && ${LEAD_FIELDS_UNSET} && ${IDENTITY_UNSET} && ${STAFF_STATUS})`;
// Ett create är alltid ett utkast i den inloggades eget namn utan lednings-/granskningsfält.
const APPLICATION_CREATE =
  `${ANY_AUTH} && ${ANY_TENANT} && @request.body.created_by = @request.auth.id && ` +
  `(@request.body.status:isset = false || @request.body.status = "draft") && ${LEAD_FIELDS_UNSET} && ${REVIEW_FIELDS_UNSET}`;

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
          // Skrivlagret kräver alltid en typ. I schemat är relationen VALFRI
          // och utan cascade: en checktyp med ansökningar får inte raderas
          // (skrivlagret vägrar), och ett ärende ska aldrig försvinna tyst —
          // men en `required` relation utan cascade skulle få PB att vägra
          // radera typen även i tenant-kaskaden (art. 17), så fältet nollas
          // i stället i det fallet.
          required: false,
          collectionId: typesCol.id,
          cascadeDelete: false,
          minSelect: 0,
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
      createRule: APPLICATION_CREATE,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_LEAD} || ${STAFF_UPDATE} || ${MEMBER_UPDATE})`,
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
