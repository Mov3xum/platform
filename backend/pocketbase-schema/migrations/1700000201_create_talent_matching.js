/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 54 — Studenter & talang: matchning mellan studenter och bolag.
//
//   talent_needs      — ett bolags BEHOV (exjobb/praktik/deltid/anställning/
//                       projekt). Skapas av bolaget (länkad medlem) eller
//                       staff; Movexum GRANSKAR och publicerar (status
//                       published) — bolaget kan aldrig publicera själv.
//   student_profiles  — studentens egen profil, registrerad på den publika
//                       sidan /s/<tenant-slug>. PRIVATPERSON utanför
//                       organisationen: samtycke, gallring (expires_at),
//                       magisk länk i stället för konto (access_token_hash).
//                       Skapas BARA av servern (createRule null).
//   talent_interests  — intresse/matchning mellan behov och student, med
//                       status (proposed/new/dialogue/matched/declined/
//                       withdrawn) och utfall. Skapas BARA av servern
//                       (studentens publika route eller bolagets/Movexums
//                       server action — efter verifiering).
//
// RLS (§ 21.3): behov + intressen medlem-scopade på `startup`
// (`linked_startups:each ?=`), studentprofiler staff/observer-only — bolaget
// ser studenter BARA genom den kurerade, anonymiserade vyn i koden tills
// studenten själv sökt/tackat ja. Inga roll-checks/joins i createRules;
// bolagets createRule pinnar tenant + skapare och låser publicerings-
// fälten. Autodate explicit (§ 28.5).
//
// GDPR § 5: student_profiles bär namn, e-post och fritext → DENYLISTAD för AI
// (lib/ai/redaction.ts), liksom talent_interests (meddelanden). Inga betyg,
// inga art. 9-fält. cascadeDelete tenant/startup/need/student (art. 17).
// EU AI Act: ingen AI rankar eller bedömer studenter (bilaga III p. 4) —
// matchningen är deterministisk i @platform/shared/talent.ts.
// Speglas i scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs.
// Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const LINKED_MEMBER =
  '(@request.auth.roles:each ?= "startup_member" && @request.auth.linked_startups:each ?= startup)';
const MEMBER_SCOPED = `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || @request.auth.linked_startups:each ?= startup)`;
const unset = (fields) => fields.map((f) => `@request.body.${f}:isset = false`).join(' && ');

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const user = (name) => ({ name, type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 });
    const autodate = [
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ];
    const tenant = { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 };
    const startup = { name: 'startup', type: 'relation', required: true, collectionId: startupsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 };

    let needs;
    try {
      needs = app.findCollectionByNameOrId('talent_needs');
    } catch (e) {
      needs = new Collection({
        id: 'talent_needs_collection',
        name: 'talent_needs',
        type: 'base',
        fields: [
          ...autodate,
          tenant,
          startup,
          { name: 'title', type: 'text', required: true, min: 3, max: 120 },
          // MÅSTE spegla TALENT_NEED_KINDS i packages/shared/src/talent.ts.
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['exjobb', 'praktik', 'deltid', 'anstallning', 'projekt'] },
          { name: 'description', type: 'text', required: false, max: 5000 },
          { name: 'tags', type: 'json', required: false, maxSize: 4000 },
          { name: 'scope', type: 'text', required: false, max: 160 },
          { name: 'starts_at', type: 'date', required: false },
          { name: 'ends_at', type: 'date', required: false },
          { name: 'compensation', type: 'select', required: false, maxSelect: 1, values: ['unpaid', 'paid', 'negotiable'] },
          { name: 'compensation_note', type: 'text', required: false, max: 200 },
          { name: 'location', type: 'text', required: false, max: 120 },
          { name: 'work_mode', type: 'select', required: false, maxSelect: 1, values: ['onsite', 'hybrid', 'remote'] },
          { name: 'supervisor', type: 'bool', required: false },
          { name: 'deadline', type: 'date', required: false },
          // MÅSTE spegla TALENT_NEED_STATUSES.
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'pending_review', 'published', 'paused', 'closed'] },
          { name: 'anonymous', type: 'bool', required: false },
          user('contact_user'),
          { name: 'review_note', type: 'text', required: false, max: 1000 },
          { name: 'published_at', type: 'date', required: false },
          user('reviewed_by'),
          user('created_by')
        ],
        indexes: [
          'CREATE INDEX idx_talent_needs_tenant_status ON talent_needs (tenant, status)',
          'CREATE INDEX idx_talent_needs_startup ON talent_needs (startup)'
        ],
        listRule: MEMBER_SCOPED,
        viewRule: MEMBER_SCOPED,
        createRule:
          `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id` +
          ` && (@request.body.status:isset = false || @request.body.status = "draft" || @request.body.status = "pending_review")` +
          ` && ${unset(['published_at', 'reviewed_by', 'review_note'])}`,
        updateRule:
          `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || (${LINKED_MEMBER} && @request.body.status != "published"` +
          ` && ${unset(['published_at', 'reviewed_by', 'review_note', 'startup', 'tenant'])}))`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || (${LINKED_MEMBER} && status = "draft"))`
      });
      app.save(needs);
    }

    let students;
    try {
      students = app.findCollectionByNameOrId('student_profiles');
    } catch (e) {
      students = new Collection({
        id: 'student_profiles_collection',
        name: 'student_profiles',
        type: 'base',
        fields: [
          ...autodate,
          tenant,
          { name: 'first_name', type: 'text', required: true, min: 1, max: 80 },
          { name: 'last_name', type: 'text', required: false, max: 80 },
          { name: 'email', type: 'email', required: true },
          { name: 'university', type: 'text', required: false, max: 120 },
          { name: 'program', type: 'text', required: false, max: 160 },
          // MÅSTE spegla STUDENT_LEVELS.
          { name: 'level', type: 'select', required: false, maxSelect: 1, values: ['kandidat', 'master', 'yrkeshogskola', 'doktorand', 'annan'] },
          { name: 'graduation_year', type: 'number', required: false, min: 2000, max: 2100, onlyInt: true },
          { name: 'tags', type: 'json', required: false, maxSize: 6000 },
          { name: 'seeking', type: 'json', required: false, maxSize: 500 },
          { name: 'available_from', type: 'date', required: false },
          { name: 'location', type: 'text', required: false, max: 120 },
          { name: 'remote_ok', type: 'bool', required: false },
          { name: 'summary', type: 'text', required: false, max: 1500 },
          { name: 'linkedin_url', type: 'url', required: false },
          { name: 'searchable', type: 'bool', required: false },
          // MÅSTE spegla STUDENT_PROFILE_STATUSES.
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'active', 'paused', 'withdrawn'] },
          { name: 'consent_at', type: 'date', required: true },
          { name: 'verified_at', type: 'date', required: false },
          { name: 'last_active_at', type: 'date', required: false },
          { name: 'expires_at', type: 'date', required: true },
          // Magisk länk: SHA-256 av en engångstoken + giltighetstid. Klartexten finns bara i mejlet.
          { name: 'access_token_hash', type: 'text', required: false, max: 64 },
          { name: 'token_expires_at', type: 'date', required: false }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_student_profiles_tenant_email ON student_profiles (tenant, email)',
          'CREATE INDEX idx_student_profiles_tenant_status ON student_profiles (tenant, status)',
          'CREATE INDEX idx_student_profiles_token ON student_profiles (access_token_hash)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: null,
        updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
      });
      app.save(students);
    }

    try {
      app.findCollectionByNameOrId('talent_interests');
    } catch (e) {
      const interests = new Collection({
        id: 'talent_interests_collection',
        name: 'talent_interests',
        type: 'base',
        fields: [
          ...autodate,
          tenant,
          { name: 'need', type: 'relation', required: true, collectionId: needs.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
          { name: 'student', type: 'relation', required: true, collectionId: students.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
          // Denormaliserat för bolagsisoleringen (§ 21) — alltid = need.startup.
          startup,
          // MÅSTE spegla TALENT_INTEREST_STATUSES.
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['proposed', 'new', 'dialogue', 'matched', 'declined', 'withdrawn'] },
          { name: 'initiated_by', type: 'select', required: true, maxSelect: 1, values: ['student', 'company', 'staff'] },
          { name: 'message', type: 'text', required: false, max: 1000 },
          { name: 'company_note', type: 'text', required: false, max: 1000 },
          // MÅSTE spegla TALENT_OUTCOMES.
          { name: 'outcome', type: 'select', required: false, maxSelect: 1, values: ['thesis_completed', 'internship_completed', 'hired', 'not_completed'] },
          { name: 'outcome_note', type: 'text', required: false, max: 500 },
          { name: 'outcome_at', type: 'date', required: false },
          { name: 'responded_at', type: 'date', required: false },
          { name: 'status_changed_at', type: 'date', required: false },
          user('changed_by'),
          user('created_by')
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_talent_interests_need_student ON talent_interests (need, student)',
          'CREATE INDEX idx_talent_interests_tenant_status ON talent_interests (tenant, status)',
          'CREATE INDEX idx_talent_interests_startup ON talent_interests (startup)',
          'CREATE INDEX idx_talent_interests_student ON talent_interests (student)'
        ],
        listRule: MEMBER_SCOPED,
        viewRule: MEMBER_SCOPED,
        createRule: null,
        updateRule:
          `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || (${LINKED_MEMBER} && ${unset(['need', 'student', 'startup', 'tenant', 'initiated_by', 'message'])}))`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
      });
      app.save(interests);
    }
  },
  (app) => {
    for (const name of ['talent_interests', 'student_profiles', 'talent_needs']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* redan borta */
      }
    }
  }
);
