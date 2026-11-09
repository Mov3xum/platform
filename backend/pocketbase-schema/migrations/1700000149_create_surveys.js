/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39 — Marknadsverktyg → Utvärdering. Digitala enkäter som staff
// bygger i webbläsaren och som besvaras ANONYMT på /u/<public_slug>.
//
// `surveys`: enkätdefinitionen (frågor som json — MÅSTE spegla SurveyQuestion
// i packages/shared/src/survey.ts). `survey_responses`: ett inskick per rad,
// bara svarsdata + valfri kanal — ingen e-post, ingen IP, ingen användar-
// relation (dataminimering GDPR § 5; enkäter är anonyma by design).
//
// Regler (§ 21.3): list/view = staff/observer via `:each ?=` (aldrig bart
// `?=` mot multi-värde-fält). createRule på `surveys` refererar bara auth-
// fält (ingen roll-check, ingen tenant-join — PB v0.23.4-buggen); rollen
// enforce:as i server-actionen. `survey_responses.createRule` är NULL
// (endast superuser): inskick sker uteslutande via den publika route-
// handlern, som härleder tenant FRÅN enkäten (§ 23.2-mönstret).
//
// PB v0.23 auto-lägger INTE created/updated vid `new Collection(...)`
// (§ 28.5) → autodate-fälten läggs explicit.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const MANAGERS =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const surveys = new Collection({
      id: 'surveys_col',
      name: 'surveys',
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
        { name: 'name', type: 'text', required: true, min: 1, max: 160 },
        {
          name: 'kind',
          type: 'select',
          required: false,
          maxSelect: 1,
          // MÅSTE spegla SURVEY_KINDS i packages/shared/src/survey.ts.
          values: ['course', 'event', 'program', 'followup', 'custom']
        },
        { name: 'description', type: 'text', required: false, max: 500 },
        { name: 'welcome_title', type: 'text', required: false, max: 160 },
        { name: 'welcome_body', type: 'text', required: false, max: 2000 },
        { name: 'thank_you_message', type: 'text', required: false, max: 500 },
        { name: 'questions', type: 'json', required: false, maxSize: 200000 },
        { name: 'is_active', type: 'bool', required: false },
        // Globalt unik, slumpad — publika länken är /u/<public_slug>.
        { name: 'public_slug', type: 'text', required: false, max: 60 },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_surveys_tenant ON surveys (tenant)',
        "CREATE UNIQUE INDEX idx_surveys_public_slug ON surveys (public_slug) WHERE public_slug != ''"
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${MANAGERS}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${MANAGERS}`
    });
    app.save(surveys);

    const responses = new Collection({
      id: 'survey_responses_col',
      name: 'survey_responses',
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
        {
          name: 'survey',
          type: 'relation',
          required: true,
          collectionId: surveys.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Validerade svar { [question.id]: string | number | string[] }.
        { name: 'answers', type: 'json', required: true, maxSize: 200000 },
        // Valfri kanal/kampanj (t.ex. utm_source) — aldrig personuppgift.
        { name: 'channel', type: 'text', required: false, max: 80 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_survey_responses_survey ON survey_responses (survey)',
        'CREATE INDEX idx_survey_responses_tenant ON survey_responses (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: null,
      updateRule: null,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${MANAGERS}`
    });
    app.save(responses);
  },
  (app) => {
    for (const name of ['survey_responses', 'surveys']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
