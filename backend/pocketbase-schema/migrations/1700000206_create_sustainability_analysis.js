/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 56 — Impact Navigator: den AI-stödda hållbarhetsanalysen per
// bolag (tidigare den fristående appen på inkubator-kohl.vercel.app, kallad
// "Sales Navigator") byggs in i plattformen på /impactnavigator och får sina
// tabeller här i stället för i Neon/Postgres. Den gamla appens dump importeras.
//
// Kartläggning mot källans Postgres-schema (pg_dump 2026-10-14):
//
//   Company  → startups (FINNS): name → name, phase → phase (mappad),
//              industry → industri. SAKNADES och läggs till här:
//                • sustainability_journey_text  ← Company.journeyText
//                • sustainability_status        ← Company.status
//                • sustainability_assigned_to   ← Company.assignedToId
//   User     → users (FINNS, matchas på e-post — Clerk-id och passwordHash
//              importeras aldrig).
//   Note     → notes (FINNS: startup/author/body, confidential=false).
//   Assessment          → sustainability_assessments (NY)
//   GapQuestion         → sustainability_gap_questions (NY)
//   MaterialityOverride → sustainability_materiality_overrides (NY)
//   UpdateEvent         → sustainability_update_events (NY)
//   Document            → sustainability_documents (NY; `file` är ett riktigt
//                         PB-filfält — originalfilerna låg i Vercel Blob och
//                         ingår inte i dumpen, `storage_path` behålls som
//                         referens; `openaiFileId` importeras inte)
//   AIJob               → sustainability_ai_jobs (NY; audit per körning)
//
// Enum-värden är källans värden i gemener (MÅSTE spegla
// scripts/lib/sustainability-import.mjs). `external_id` bär källans cuid
// så importen är idempotent (unikt partiellt index).
//
// RLS (§ 21.3): list/view staff/observer (personalverktyg — ingen
// bolagsmedlemsyta); create pinnar tenant + skapare (§ 21.8, ingen
// roll-check/join); update Movexum-personal; delete ledningen. Autodate
// explicit (§ 28.5).
//
// GDPR § 5: analyserna är bolagsdata; `sustainability_documents.extracted_text`
// (text ur uppladdade dokument) och `sustainability_ai_jobs.output` (rå
// modellutdata) är fritext ur tredjepartsmaterial → DENYLISTADE för AI i
// lib/ai/redaction.ts. Personnummer saneras på importvägen. cascadeDelete på
// tenant/startup/assessment (art. 17). Speglas i scripts/setup-via-api.mjs,
// asserteras i verify-baseline.mjs. Riskklass: begränsad (beslutsstöd,
// människa granskar) — se § 56. Oföränderlig migration (nytt filnummer).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const BODY_TENANT = '@request.body.tenant = @request.auth.tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

const SUSTAINABILITY_STATUSES = ['draft', 'materiality_review', 'info_collection', 'needs_more_info', 'analyzed'];
const ASSESSMENT_TYPES = ['initial', 'update'];
const ASSESSMENT_STATUSES = [
  'materiality_pending',
  'materiality_review',
  'info_pending',
  'needs_more_info',
  'final_pending',
  'complete',
  'failed'
];
const GAP_SEVERITIES = ['required', 'recommended'];
const GAP_STATUSES = ['open', 'answered', 'not_available'];
const UPLOAD_STAGES = ['idea_description', 'full_information', 'gap_response', 'update'];
const EXTRACTION_STATUSES = ['pending', 'complete', 'failed'];
const AI_JOB_TYPES = ['materiality', 'sufficiency', 'final_analysis', 'update_analysis'];
const AI_JOB_STATUSES = ['pending', 'running', 'complete', 'failed'];
const DOCUMENT_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv'
];

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const user = (name) => ({
      name,
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    const rel = (name, collectionId, { required = false, cascade = false } = {}) => ({
      name,
      type: 'relation',
      required,
      collectionId,
      cascadeDelete: cascade,
      minSelect: required ? 1 : 0,
      maxSelect: 1
    });
    const autodate = () => [
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ];
    // Källans cuid (idempotent import) + källans skapandetid: `created` är
    // autodate och kan inte sättas vid import, så den ursprungliga tidpunkten
    // bevaras här (tomt för poster som skapas direkt i plattformen).
    const externalId = () => ({ name: 'external_id', type: 'text', required: false, max: 40 });
    const sourceCreatedAt = () => ({ name: 'source_created_at', type: 'date', required: false });

    // 1. startups: de Company-kolumner som saknades.
    const startupFields = startupsCol.fields;
    const addStartupField = (field) => {
      if (startupFields.getByName(field.name)) return;
      startupFields.add(new Field(field));
    };
    addStartupField({ name: 'sustainability_journey_text', type: 'text', required: false, max: 20000 });
    addStartupField({
      name: 'sustainability_status',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: SUSTAINABILITY_STATUSES
    });
    addStartupField(user('sustainability_assigned_to'));
    app.save(startupsCol);

    const exists = (name) => {
      try {
        app.findCollectionByNameOrId(name);
        return true;
      } catch (e) {
        return false;
      }
    };

    const rules = (createRule) => ({
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
    });
    const createPinned = (field) => `${ANY_AUTH} && ${BODY_TENANT} && @request.body.${field} = @request.auth.id`;
    const createTenantOnly = `${ANY_AUTH} && ${BODY_TENANT}`;

    // 2. sustainability_assessments (Assessment).
    if (!exists('sustainability_assessments')) {
      const assessments = new Collection(Object.assign({
        id: 'sustainability_assessments_collection',
        name: 'sustainability_assessments',
        type: 'base',
        fields: autodate().concat([
          rel('tenant', tenantsCol.id, { required: true, cascade: true }),
          rel('startup', startupsCol.id, { required: true, cascade: true }),
          { name: 'version', type: 'number', required: true, min: 1, onlyInt: true },
          { name: 'type', type: 'select', required: true, maxSelect: 1, values: ASSESSMENT_TYPES },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ASSESSMENT_STATUSES },
          { name: 'framework_version', type: 'text', required: true, min: 1, max: 60 },
          { name: 'materiality', type: 'json', required: false, maxSize: 200000 },
          { name: 'sufficiency', type: 'json', required: false, maxSize: 200000 },
          { name: 'dashboard', type: 'json', required: false, maxSize: 400000 },
          { name: 'update_delta', type: 'json', required: false, maxSize: 200000 },
          { name: 'information_quality_score', type: 'number', required: false, min: 0, max: 100, onlyInt: true },
          { name: 'model_name', type: 'text', required: false, max: 80 },
          { name: 'prompt_version', type: 'text', required: false, max: 60 },
          { name: 'input_hash', type: 'text', required: false, max: 128 },
          user('created_by'),
          { name: 'completed_at', type: 'date', required: false },
          externalId(),
          sourceCreatedAt()
        ]),
        indexes: [
          'CREATE UNIQUE INDEX idx_sustainability_assessments_startup_version ON sustainability_assessments (startup, version)',
          'CREATE INDEX idx_sustainability_assessments_tenant_startup ON sustainability_assessments (tenant, startup)',
          "CREATE UNIQUE INDEX idx_sustainability_assessments_external ON sustainability_assessments (tenant, external_id) WHERE external_id != ''"
        ]
        }, rules(createPinned('created_by'))));
      app.save(assessments);
      // Self-relation läggs efter första save:n (kollektionen måste finnas).
      assessments.fields.add(
        new Field({
          name: 'previous_assessment',
          type: 'relation',
          required: false,
          collectionId: assessments.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
      app.save(assessments);
    }
    const assessmentsCol = app.findCollectionByNameOrId('sustainability_assessments');

    // 3. sustainability_gap_questions (GapQuestion).
    if (!exists('sustainability_gap_questions')) {
      app.save(
        new Collection(Object.assign({
          id: 'sustainability_gap_questions_collection',
          name: 'sustainability_gap_questions',
          type: 'base',
          fields: autodate().concat([
            rel('tenant', tenantsCol.id, { required: true, cascade: true }),
            rel('assessment', assessmentsCol.id, { required: true, cascade: true }),
            { name: 'aspect_code', type: 'text', required: true, min: 1, max: 40 },
            { name: 'question', type: 'text', required: true, min: 1, max: 2000 },
            { name: 'missing_information', type: 'text', required: false, max: 2000 },
            { name: 'severity', type: 'select', required: true, maxSelect: 1, values: GAP_SEVERITIES },
            { name: 'status', type: 'select', required: true, maxSelect: 1, values: GAP_STATUSES },
            { name: 'answer_text', type: 'text', required: false, max: 10000 },
            externalId(),
            sourceCreatedAt()
          ]),
          indexes: [
            'CREATE INDEX idx_sustainability_gap_questions_assessment ON sustainability_gap_questions (assessment)',
            "CREATE UNIQUE INDEX idx_sustainability_gap_questions_external ON sustainability_gap_questions (tenant, external_id) WHERE external_id != ''"
          ]
          }, rules(createTenantOnly)))
      );
    }

    // 4. sustainability_materiality_overrides (MaterialityOverride).
    if (!exists('sustainability_materiality_overrides')) {
      app.save(
        new Collection(Object.assign({
          id: 'sustainability_materiality_overrides_collection',
          name: 'sustainability_materiality_overrides',
          type: 'base',
          fields: autodate().concat([
            rel('tenant', tenantsCol.id, { required: true, cascade: true }),
            rel('assessment', assessmentsCol.id, { required: true, cascade: true }),
            { name: 'aspect_code', type: 'text', required: true, min: 1, max: 40 },
            { name: 'original_status', type: 'text', required: true, min: 1, max: 40 },
            { name: 'new_status', type: 'text', required: true, min: 1, max: 40 },
            { name: 'comment', type: 'text', required: false, max: 5000 },
            user('created_by'),
            externalId(),
            sourceCreatedAt()
          ]),
          indexes: [
            'CREATE INDEX idx_sustainability_overrides_assessment ON sustainability_materiality_overrides (assessment)',
            "CREATE UNIQUE INDEX idx_sustainability_overrides_external ON sustainability_materiality_overrides (tenant, external_id) WHERE external_id != ''"
          ]
          }, rules(createPinned('created_by'))))
      );
    }

    // 5. sustainability_update_events (UpdateEvent).
    if (!exists('sustainability_update_events')) {
      app.save(
        new Collection(Object.assign({
          id: 'sustainability_update_events_collection',
          name: 'sustainability_update_events',
          type: 'base',
          fields: autodate().concat([
            rel('tenant', tenantsCol.id, { required: true, cascade: true }),
            rel('startup', startupsCol.id, { required: true, cascade: true }),
            rel('assessment', assessmentsCol.id),
            user('created_by'),
            { name: 'narrative', type: 'text', required: false, max: 20000 },
            externalId(),
            sourceCreatedAt()
          ]),
          indexes: [
            'CREATE INDEX idx_sustainability_update_events_startup ON sustainability_update_events (startup)',
            "CREATE UNIQUE INDEX idx_sustainability_update_events_external ON sustainability_update_events (tenant, external_id) WHERE external_id != ''"
          ]
          }, rules(createPinned('created_by'))))
      );
    }
    const updateEventsCol = app.findCollectionByNameOrId('sustainability_update_events');
    const gapQuestionsCol = app.findCollectionByNameOrId('sustainability_gap_questions');

    // 6. sustainability_documents (Document).
    if (!exists('sustainability_documents')) {
      app.save(
        new Collection(Object.assign({
          id: 'sustainability_documents_collection',
          name: 'sustainability_documents',
          type: 'base',
          fields: autodate().concat([
            rel('tenant', tenantsCol.id, { required: true, cascade: true }),
            rel('startup', startupsCol.id, { required: true, cascade: true }),
            rel('assessment', assessmentsCol.id),
            rel('update_event', updateEventsCol.id),
            rel('gap_question', gapQuestionsCol.id),
            user('uploaded_by'),
            { name: 'upload_stage', type: 'select', required: true, maxSelect: 1, values: UPLOAD_STAGES },
            { name: 'original_name', type: 'text', required: true, min: 1, max: 300 },
            { name: 'mime', type: 'text', required: false, max: 150 },
            { name: 'size_bytes', type: 'number', required: false, min: 0, onlyInt: true },
            { name: 'file', type: 'file', required: false, maxSelect: 1, maxSize: 26214400, mimeTypes: DOCUMENT_MIMES, protected: true },
            // Källans lagringssökväg (Vercel Blob) — bara referens, filen ingick inte i dumpen.
            { name: 'storage_path', type: 'text', required: false, max: 500 },
            { name: 'extracted_text', type: 'text', required: false, max: 300000 },
            { name: 'extraction_status', type: 'select', required: false, maxSelect: 1, values: EXTRACTION_STATUSES },
            { name: 'extraction_warning', type: 'text', required: false, max: 500 },
            externalId(),
            sourceCreatedAt()
          ]),
          indexes: [
            'CREATE INDEX idx_sustainability_documents_startup ON sustainability_documents (startup)',
            'CREATE INDEX idx_sustainability_documents_assessment ON sustainability_documents (assessment)',
            "CREATE UNIQUE INDEX idx_sustainability_documents_external ON sustainability_documents (tenant, external_id) WHERE external_id != ''"
          ]
          }, rules(createPinned('uploaded_by'))))
      );
    }

    // 7. sustainability_ai_jobs (AIJob).
    if (!exists('sustainability_ai_jobs')) {
      app.save(
        new Collection(Object.assign({
          id: 'sustainability_ai_jobs_collection',
          name: 'sustainability_ai_jobs',
          type: 'base',
          fields: autodate().concat([
            rel('tenant', tenantsCol.id, { required: true, cascade: true }),
            rel('startup', startupsCol.id, { required: true, cascade: true }),
            rel('assessment', assessmentsCol.id),
            { name: 'job_type', type: 'select', required: true, maxSelect: 1, values: AI_JOB_TYPES },
            { name: 'status', type: 'select', required: true, maxSelect: 1, values: AI_JOB_STATUSES },
            { name: 'input_hash', type: 'text', required: false, max: 128 },
            { name: 'model_name', type: 'text', required: false, max: 80 },
            { name: 'prompt_version', type: 'text', required: false, max: 60 },
            { name: 'output', type: 'json', required: false, maxSize: 400000 },
            { name: 'error', type: 'text', required: false, max: 2000 },
            { name: 'completed_at', type: 'date', required: false },
            externalId(),
            sourceCreatedAt()
          ]),
          indexes: [
            'CREATE INDEX idx_sustainability_ai_jobs_startup ON sustainability_ai_jobs (startup)',
            'CREATE INDEX idx_sustainability_ai_jobs_assessment ON sustainability_ai_jobs (assessment)',
            "CREATE UNIQUE INDEX idx_sustainability_ai_jobs_external ON sustainability_ai_jobs (tenant, external_id) WHERE external_id != ''"
          ]
          }, rules(createTenantOnly)))
      );
    }
  },
  (app) => {
    for (const name of [
      'sustainability_ai_jobs',
      'sustainability_documents',
      'sustainability_update_events',
      'sustainability_materiality_overrides',
      'sustainability_gap_questions',
      'sustainability_assessments'
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        // redan borta
      }
    }
    try {
      const startupsCol = app.findCollectionByNameOrId('startups');
      for (const f of ['sustainability_journey_text', 'sustainability_status', 'sustainability_assigned_to']) {
        startupsCol.fields.removeByName(f);
      }
      app.save(startupsCol);
    } catch (e) {
      // startups saknas
    }
  }
);
