/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 61 — SPARK: energimatchning (regional behovs- och
// innovationsdatabas inom energiområdet).
//
//   spark_interviews  ett intervjusvar/en anmälan (det adaptiva formuläret):
//                     råa svar + status. Skapas av Movexum, av en PARTNER
//                     (Högskolan, kommuner — ser bara sina egna), via import
//                     eller av företaget självt på den publika sidan
//                     (servern, created_by tomt). Movexum för in svaret i
//                     registret (status applied) — allt går via Movexum.
//   spark_actors      aktörsregistret: en rad per organisation, oavsett roll
//   spark_needs       behov (energiutmaningar) per aktör
//   spark_solutions   lösningar per aktör, med TRL och Movexums
//                     kategorisering inför acceleratorprogrammet
//   spark_testbeds    testmiljöer och pilotkunder per aktör
//   spark_matches     behov × lösning × testmiljö med status och uppföljning
//
// RLS (§ 21.3): registret och matchningarna läses bara av Movexum-personal +
// observer. Intervjuer läses dessutom av den som skapade dem (partnern).
// Inga roll-checks/joins i createRules — tenant + skapare pinnas, rollen
// prövas i skrivlagret (lib/core/write/spark.ts). Flyttlås på tenant
// (§ 21.8). Kategorier lagras som text/json (validerade i
// packages/shared/src/spark.ts) så listorna kan utökas utan migration;
// statusfälten är select och MÅSTE spegla konstanterna där.
//
// GDPR § 5: organisationer, inte privatpersoner. Kontaktpersonens namn, roll,
// e-post och telefon lagras på aktören BARA när företaget sagt ja till
// kontakt (berättigat intresse: matchning inom projektet). spark_interviews
// (råa svar inkl. kontaktuppgifter och fritext) är denylistad för AI.
// cascadeDelete tenant → aktör → behov/lösningar/testmiljöer (art. 17).
// Autodate explicit (§ 28.5). Speglas i scripts/setup-via-api.mjs och
// asserteras i verify-baseline.mjs. Oföränderlig migration.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const TENANT_MOVE_LOCK = '(@request.body.tenant:isset = false || @request.body.tenant = tenant)';
const OWN = 'created_by = @request.auth.id';
const PINNED_CREATE = `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`;
const unset = (fields) => fields.map((f) => `@request.body.${f}:isset = false`).join(' && ');

const READ = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`;
const REGISTRY_RULES = {
  listRule: READ,
  viewRule: READ,
  createRule: PINNED_CREATE,
  updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF} && ${TENANT_MOVE_LOCK}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
};

const NAMES = ['spark_matches', 'spark_testbeds', 'spark_solutions', 'spark_needs', 'spark_interviews', 'spark_actors'];

migrate(
  (app) => {
    const find = (name) => {
      try {
        return app.findCollectionByNameOrId(name);
      } catch (e) {
        return null;
      }
    };
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const autodate = [
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ];
    const tenant = { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 };
    const user = (name) => ({ name, type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 });
    const rel = (name, col, opts) => ({
      name,
      type: 'relation',
      required: Boolean(opts && opts.required),
      collectionId: col.id,
      cascadeDelete: Boolean(opts && opts.cascade),
      minSelect: opts && opts.required ? 1 : 0,
      maxSelect: 1
    });
    const text = (name, max, required) => ({ name, type: 'text', required: Boolean(required), max });
    const json = (name, maxSize) => ({ name, type: 'json', required: false, maxSize: maxSize || 4000 });
    const select = (name, values, required) => ({ name, type: 'select', required: Boolean(required), maxSelect: 1, values });
    const bool = (name) => ({ name, type: 'bool', required: false });
    const date = (name) => ({ name, type: 'date', required: false });

    let actors = find('spark_actors');
    if (!actors) {
      actors = new Collection({
        id: 'spark_actors_collection',
        name: 'spark_actors',
        type: 'base',
        fields: [
          ...autodate,
          tenant,
          text('name', 200, true),
          text('org_nr', 20),
          text('actor_type', 40),
          text('sector', 40),
          text('business', 500),
          text('kommun', 40),
          text('size', 20),
          json('roles', 500),
          text('energy_importance', 20),
          text('energy_work', 20),
          text('development_areas', 3000),
          text('pilot_interest', 20),
          text('academia_interest', 20),
          text('need_matching', 20),
          text('solution_matching', 20),
          json('support_needs', 2000),
          text('program_interest', 20),
          bool('info_ok'),
          bool('events_ok'),
          bool('contact_ok'),
          text('sharing', 20),
          text('contact_name', 120),
          text('contact_role', 120),
          text('contact_email', 200),
          text('contact_phone', 40),
          text('website', 300),
          text('notes', 3000),
          // Portföljbolag: kopplingen gör att bolaget inte registreras två gånger
          // och att TRL-bedömningen här hoppas över (KTH IRL på bolagskortet).
          rel('startup', startupsCol),
          // MÅSTE spegla SPARK_ACTOR_STATUSES.
          select('status', ['active', 'archived'], true),
          user('created_by')
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_spark_actors_tenant_orgnr ON spark_actors (tenant, org_nr) WHERE org_nr != ''",
          'CREATE INDEX idx_spark_actors_tenant_status ON spark_actors (tenant, status)'
        ],
        ...REGISTRY_RULES
      });
      app.save(actors);
    }

    let interviews = find('spark_interviews');
    if (!interviews) {
      const readOwn = `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${OWN})`;
      interviews = new Collection({
        id: 'spark_interviews_collection',
        name: 'spark_interviews',
        type: 'base',
        fields: [
          ...autodate,
          tenant,
          text('company_name', 200, true),
          text('org_nr', 20),
          json('roles', 500),
          json('answers', 300000),
          // MÅSTE spegla SPARK_INTERVIEW_STATUSES / _SOURCES.
          select('status', ['draft', 'submitted', 'applied'], true),
          select('source', ['staff', 'partner', 'import', 'self'], true),
          text('interviewer_org', 160),
          date('interviewed_at'),
          rel('actor', actors),
          // Partnern (t.ex. en kommun) vars delningslänk företaget kom in via.
          user('referred_by'),
          date('consent_at'),
          date('submitted_at'),
          date('applied_at'),
          user('applied_by'),
          user('created_by')
        ],
        indexes: [
          'CREATE INDEX idx_spark_interviews_tenant_status ON spark_interviews (tenant, status)',
          'CREATE INDEX idx_spark_interviews_created_by ON spark_interviews (created_by)',
          'CREATE INDEX idx_spark_interviews_referred_by ON spark_interviews (referred_by)'
        ],
        listRule: readOwn,
        viewRule: readOwn,
        createRule:
          `${PINNED_CREATE} && (@request.body.status:isset = false || @request.body.status = "draft" || @request.body.status = "submitted")` +
          ` && ${unset(['applied_at', 'applied_by', 'actor', 'referred_by'])}`,
        updateRule:
          `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || (${OWN} && status != "applied" && @request.body.status != "applied"` +
          ` && ${unset(['applied_at', 'applied_by', 'actor', 'referred_by', 'created_by', 'source'])})) && ${TENANT_MOVE_LOCK}`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${LEAD} || (${OWN} && status = "draft"))`
      });
      app.save(interviews);
    }

    const child = (name) => [
      ...autodate,
      tenant,
      rel('actor', actors, { required: true, cascade: true }),
      rel('interview', interviews),
      text('source_key', 40)
    ];
    const childIndexes = (name) => [
      `CREATE INDEX idx_${name}_tenant_status ON ${name} (tenant, status)`,
      `CREATE INDEX idx_${name}_actor ON ${name} (actor)`,
      `CREATE UNIQUE INDEX idx_${name}_source ON ${name} (interview, source_key) WHERE interview != '' AND source_key != ''`
    ];

    let needs = find('spark_needs');
    if (!needs) {
      needs = new Collection({
        id: 'spark_needs_collection',
        name: 'spark_needs',
        type: 'base',
        fields: [
          ...child('spark_needs'),
          text('title', 160, true),
          text('description', 4000),
          json('areas'),
          text('process_note', 1000),
          text('unmet', 20),
          json('consequences'),
          text('priority', 20),
          text('horizon', 20),
          text('tried', 2000),
          // MÅSTE spegla SPARK_NEED_STATUSES.
          select('status', ['open', 'matched', 'solved', 'closed'], true),
          user('created_by')
        ],
        indexes: childIndexes('spark_needs'),
        ...REGISTRY_RULES
      });
      app.save(needs);
    }

    let solutions = find('spark_solutions');
    if (!solutions) {
      solutions = new Collection({
        id: 'spark_solutions_collection',
        name: 'spark_solutions',
        type: 'base',
        fields: [
          ...child('spark_solutions'),
          text('name', 160, true),
          text('description', 4000),
          text('problem', 2000),
          json('areas'),
          json('target_sectors'),
          json('contributions'),
          { name: 'maturity', type: 'number', required: false, min: 0, max: 6, onlyInt: true },
          // TRL 1–9: företagets egen uppgift respektive Movexums bedömning (0 = ej angiven).
          { name: 'trl', type: 'number', required: false, min: 0, max: 9, onlyInt: true },
          { name: 'trl_assessed', type: 'number', required: false, min: 0, max: 9, onlyInt: true },
          text('accelerator_category', 30),
          text('accelerator_note', 1000),
          user('assessed_by'),
          date('assessed_at'),
          text('verified', 20),
          json('needs'),
          text('barriers', 2000),
          text('expansion', 1000),
          // MÅSTE spegla SPARK_SOLUTION_STATUSES.
          select('status', ['active', 'paused', 'closed'], true),
          user('created_by')
        ],
        indexes: childIndexes('spark_solutions'),
        ...REGISTRY_RULES
      });
      app.save(solutions);
    }

    let testbeds = find('spark_testbeds');
    if (!testbeds) {
      testbeds = new Collection({
        id: 'spark_testbeds_collection',
        name: 'spark_testbeds',
        type: 'base',
        fields: [
          ...child('spark_testbeds'),
          // MÅSTE spegla SPARK_TESTBED_KINDS / _STATUSES.
          select('kind', ['test_environment', 'pilot_customer'], true),
          text('description', 3000),
          json('areas'),
          text('conditions', 2000),
          select('status', ['available', 'paused', 'closed'], true),
          user('created_by')
        ],
        indexes: childIndexes('spark_testbeds'),
        ...REGISTRY_RULES
      });
      app.save(testbeds);
    }

    if (!find('spark_matches')) {
      app.save(
        new Collection({
          id: 'spark_matches_collection',
          name: 'spark_matches',
          type: 'base',
          fields: [
            ...autodate,
            tenant,
            rel('need', needs, { cascade: true }),
            rel('solution', solutions, { cascade: true }),
            rel('testbed', testbeds, { cascade: true }),
            // MÅSTE spegla SPARK_MATCH_STATUSES / SPARK_CONSENTS / SPARK_SUPPORT_KINDS.
            select('status', ['suggested', 'introduced', 'dialogue', 'pilot_planned', 'pilot_running', 'completed', 'declined'], true),
            select('need_consent', ['pending', 'yes', 'no']),
            select('solution_consent', ['pending', 'yes', 'no']),
            user('owner'),
            text('next_step', 300),
            date('next_step_due'),
            text('notes', 3000),
            text('outcome', 2000),
            { name: 'score', type: 'number', required: false },
            json('reasons', 4000),
            select('support_kind', ['none', 'de_minimis']),
            bool('support_confirmed'),
            text('support_note', 500),
            text('work_package', 20),
            date('status_changed_at'),
            user('created_by')
          ],
          indexes: [
            'CREATE INDEX idx_spark_matches_tenant_status ON spark_matches (tenant, status)',
            'CREATE INDEX idx_spark_matches_need ON spark_matches (need)',
            'CREATE INDEX idx_spark_matches_solution ON spark_matches (solution)',
            "CREATE UNIQUE INDEX idx_spark_matches_pair ON spark_matches (need, solution, testbed)"
          ],
          ...REGISTRY_RULES
        })
      );
    }
  },
  (app) => {
    for (const name of NAMES) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* redan borta */
      }
    }
  }
);
