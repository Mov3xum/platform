/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 58 — Export Lab: den AI-stödda internationaliseringsanalysen
// per bolag (exportprofil & marknadsurval → informationsgap → första
// exportplan → versionerade uppdateringar). Samma mönster som Impact
// Navigator (1700000206):
//
//   startups (FINNS) får: export_ambition_text (innovation + internationell
//     ambition), export_desired_markets (bolagets egna önskemål, fritext),
//     export_status, export_assigned_to
//   export_assessments        — analysversion per bolag (unik startup+version)
//   export_gap_questions      — kompletteringsfrågor per version
//   export_market_reviews     — personalens marknadsbeslut (audit av
//                               granskningen, § 21.8)
//   export_update_events      — "vad har hänt" per uppdatering
//   export_documents          — uppladdat underlag (riktigt PB-filfält,
//                               protected) + utläst, personnummer-sanerad text
//   export_ai_jobs            — audit per modellkörning (art. 12)
//
// Enum-värden MÅSTE spegla packages/shared/src/export-lab.ts.
//
// RLS (§ 21.3): list/view staff/observer (personalverktyg — ingen
// bolagsmedlemsyta); create pinnar tenant + skapare (§ 21.8, ingen
// roll-check/join); update Movexum-personal; delete ledningen. Autodate
// explicit (§ 28.5).
//
// GDPR § 5: analyserna är bolagsdata; `export_documents.extracted_text` och
// `export_ai_jobs.output` är fritext ur tredjepartsmaterial/rå modellutdata →
// DENYLISTADE för AI i lib/ai/redaction.ts. cascadeDelete på
// tenant/startup/assessment (art. 17). Speglas i scripts/setup-via-api.mjs,
// asserteras i verify-baseline.mjs. Riskklass: begränsad (beslutsstöd om
// bolag, människa granskar). Oföränderlig migration (nytt filnummer).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const BODY_TENANT = '@request.body.tenant = @request.auth.tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

const COMPANY_STATUSES = ['draft', 'market_review', 'info_collection', 'needs_more_info', 'planned'];
const ASSESSMENT_TYPES = ['initial', 'update'];
const ASSESSMENT_STATUSES = ['profile_pending', 'market_review', 'info_pending', 'needs_more_info', 'plan_pending', 'complete', 'failed'];
const GAP_SEVERITIES = ['required', 'recommended'];
const GAP_STATUSES = ['open', 'answered', 'not_available'];
const UPLOAD_STAGES = ['innovation_description', 'full_information', 'gap_response', 'update'];
const EXTRACTION_STATUSES = ['pending', 'complete', 'failed'];
const AI_JOB_TYPES = ['profile', 'sufficiency', 'plan', 'update_plan'];
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

    const user = (name) => ({ name, type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 });
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

    // 1. startups: Export Lab-fälten.
    const startupFields = startupsCol.fields;
    const addStartupField = (field) => {
      if (startupFields.getByName(field.name)) return;
      startupFields.add(new Field(field));
    };
    addStartupField({ name: 'export_ambition_text', type: 'text', required: false, max: 20000 });
    addStartupField({ name: 'export_desired_markets', type: 'text', required: false, max: 1000 });
    addStartupField({ name: 'export_status', type: 'select', required: false, maxSelect: 1, values: COMPANY_STATUSES });
    addStartupField(user('export_assigned_to'));
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

    // 2. export_assessments
    if (!exists('export_assessments')) {
      const assessments = new Collection(
        Object.assign(
          {
            id: 'export_assessments_collection',
            name: 'export_assessments',
            type: 'base',
            fields: autodate().concat([
              rel('tenant', tenantsCol.id, { required: true, cascade: true }),
              rel('startup', startupsCol.id, { required: true, cascade: true }),
              { name: 'version', type: 'number', required: true, min: 1, onlyInt: true },
              { name: 'type', type: 'select', required: true, maxSelect: 1, values: ASSESSMENT_TYPES },
              { name: 'status', type: 'select', required: true, maxSelect: 1, values: ASSESSMENT_STATUSES },
              { name: 'framework_version', type: 'text', required: true, min: 1, max: 60 },
              { name: 'profile', type: 'json', required: false, maxSize: 300000 },
              { name: 'sufficiency', type: 'json', required: false, maxSize: 200000 },
              { name: 'plan', type: 'json', required: false, maxSize: 500000 },
              { name: 'update_delta', type: 'json', required: false, maxSize: 200000 },
              // Ögonblicksbild av IRL-profilen när steget kördes (transparens art. 13).
              { name: 'irl_snapshot', type: 'json', required: false, maxSize: 20000 },
              { name: 'information_quality_score', type: 'number', required: false, min: 0, max: 100, onlyInt: true },
              { name: 'model_name', type: 'text', required: false, max: 80 },
              { name: 'prompt_version', type: 'text', required: false, max: 60 },
              { name: 'input_hash', type: 'text', required: false, max: 128 },
              user('created_by'),
              { name: 'completed_at', type: 'date', required: false }
            ]),
            indexes: [
              'CREATE UNIQUE INDEX idx_export_assessments_startup_version ON export_assessments (startup, version)',
              'CREATE INDEX idx_export_assessments_tenant_startup ON export_assessments (tenant, startup)'
            ]
          },
          rules(createPinned('created_by'))
        )
      );
      app.save(assessments);
      assessments.fields.add(
        new Field({ name: 'previous_assessment', type: 'relation', required: false, collectionId: assessments.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 })
      );
      app.save(assessments);
    }
    const assessmentsCol = app.findCollectionByNameOrId('export_assessments');

    // 3. export_gap_questions
    if (!exists('export_gap_questions')) {
      app.save(
        new Collection(
          Object.assign(
            {
              id: 'export_gap_questions_collection',
              name: 'export_gap_questions',
              type: 'base',
              fields: autodate().concat([
                rel('tenant', tenantsCol.id, { required: true, cascade: true }),
                rel('assessment', assessmentsCol.id, { required: true, cascade: true }),
                { name: 'target_code', type: 'text', required: true, min: 1, max: 40 },
                { name: 'question', type: 'text', required: true, min: 1, max: 2000 },
                { name: 'missing_information', type: 'text', required: false, max: 2000 },
                { name: 'severity', type: 'select', required: true, maxSelect: 1, values: GAP_SEVERITIES },
                { name: 'status', type: 'select', required: true, maxSelect: 1, values: GAP_STATUSES },
                { name: 'answer_text', type: 'text', required: false, max: 10000 }
              ]),
              indexes: ['CREATE INDEX idx_export_gap_questions_assessment ON export_gap_questions (assessment)']
            },
            rules(createTenantOnly)
          )
        )
      );
    }

    // 4. export_market_reviews
    if (!exists('export_market_reviews')) {
      app.save(
        new Collection(
          Object.assign(
            {
              id: 'export_market_reviews_collection',
              name: 'export_market_reviews',
              type: 'base',
              fields: autodate().concat([
                rel('tenant', tenantsCol.id, { required: true, cascade: true }),
                rel('assessment', assessmentsCol.id, { required: true, cascade: true }),
                { name: 'market_code', type: 'text', required: true, min: 1, max: 40 },
                { name: 'country', type: 'text', required: false, max: 120 },
                { name: 'original_priority', type: 'text', required: true, min: 1, max: 40 },
                { name: 'new_priority', type: 'text', required: true, min: 1, max: 40 },
                { name: 'comment', type: 'text', required: false, max: 5000 },
                user('created_by')
              ]),
              indexes: ['CREATE INDEX idx_export_market_reviews_assessment ON export_market_reviews (assessment)']
            },
            rules(createPinned('created_by'))
          )
        )
      );
    }

    // 5. export_update_events
    if (!exists('export_update_events')) {
      app.save(
        new Collection(
          Object.assign(
            {
              id: 'export_update_events_collection',
              name: 'export_update_events',
              type: 'base',
              fields: autodate().concat([
                rel('tenant', tenantsCol.id, { required: true, cascade: true }),
                rel('startup', startupsCol.id, { required: true, cascade: true }),
                rel('assessment', assessmentsCol.id),
                user('created_by'),
                { name: 'narrative', type: 'text', required: false, max: 20000 }
              ]),
              indexes: ['CREATE INDEX idx_export_update_events_startup ON export_update_events (startup)']
            },
            rules(createPinned('created_by'))
          )
        )
      );
    }
    const updateEventsCol = app.findCollectionByNameOrId('export_update_events');
    const gapQuestionsCol = app.findCollectionByNameOrId('export_gap_questions');

    // 6. export_documents
    if (!exists('export_documents')) {
      app.save(
        new Collection(
          Object.assign(
            {
              id: 'export_documents_collection',
              name: 'export_documents',
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
                { name: 'extracted_text', type: 'text', required: false, max: 300000 },
                { name: 'extraction_status', type: 'select', required: false, maxSelect: 1, values: EXTRACTION_STATUSES },
                { name: 'extraction_warning', type: 'text', required: false, max: 500 }
              ]),
              indexes: [
                'CREATE INDEX idx_export_documents_startup ON export_documents (startup)',
                'CREATE INDEX idx_export_documents_assessment ON export_documents (assessment)'
              ]
            },
            rules(createPinned('uploaded_by'))
          )
        )
      );
    }

    // 7. export_ai_jobs
    if (!exists('export_ai_jobs')) {
      app.save(
        new Collection(
          Object.assign(
            {
              id: 'export_ai_jobs_collection',
              name: 'export_ai_jobs',
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
                { name: 'output', type: 'json', required: false, maxSize: 500000 },
                { name: 'error', type: 'text', required: false, max: 2000 },
                { name: 'completed_at', type: 'date', required: false }
              ]),
              indexes: ['CREATE INDEX idx_export_ai_jobs_startup ON export_ai_jobs (startup)', 'CREATE INDEX idx_export_ai_jobs_assessment ON export_ai_jobs (assessment)']
            },
            rules(createTenantOnly)
          )
        )
      );
    }
  },
  (app) => {
    for (const name of ['export_ai_jobs', 'export_documents', 'export_update_events', 'export_market_reviews', 'export_gap_questions', 'export_assessments']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        // redan borta
      }
    }
    try {
      const startupsCol = app.findCollectionByNameOrId('startups');
      for (const f of ['export_ambition_text', 'export_desired_markets', 'export_status', 'export_assigned_to']) startupsCol.fields.removeByName(f);
      app.save(startupsCol);
    } catch (e) {
      // startups saknas
    }
  }
);
