/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 51.6 — Bedömning excellens på bolagskortet + begäran om
// komplettering.
//
// `startup_screenings`: en rad per körning av Bedömning excellens för ett
// PORTFÖLJBOLAG — utfall (art. 22 GBER / de minimis, Vinnovas målgrupp,
// excellens), en kompakt PII-fri sammanfattning (`summary`: varje punkts
// utfall + källa, saknat underlag, koncernens bolag, viktat tröskelvärde —
// aldrig `detail`-texter som kan bära grundarnamn) och själva PDF:en
// (protected fil, serveras via den tenant-scopade proxyn
// /api/screenings/<id>/pdf). Kollegor och revisorer får samma bild som
// controllern; två körningar i rad jämförs → "vad ändrades sedan senast".
// RLS: list/view staff/observer-only (bedömningsunderlag om statsstöd är
// intern data; bolaget ser bara begäran om komplettering nedan).
// create: tenant + `assessed_by` pinnade till den inloggade (§ 21.8);
// update/delete: ledningen (en körning är ett spår — den skrivs inte om).
//
// `screening_requests`: controllerns begäran till COACHEN eller till
// BOLAGET om att komplettera underlaget (punkterna ur bedömningens
// "Saknat underlag", `items` json — se packages/shared/src/
// excellence-requests.ts). Båda svarar direkt i systemet; svaren slås ihop
// till `startups.screening_facts` (EN sanning, § 51.4) och punkten markeras
// besvarad med en PII-fri etikett. RLS: list/view staff/observer ELLER en
// bolagsmedlem länkad till bolaget NÄR förfrågan är ställd till bolaget
// (`recipient_kind = "startup"`) — en förfrågan till coachen (kan bära
// controllerns interna notering) når aldrig bolaget. create: tenant +
// `requested_by` pinnade; update: Movexum-personal, eller den länkade
// medlemmen för en bolagsförfrågan med identitets-/avsändarfälten låsta
// (`@request.body.<fält>:isset = false`) — skrivlagret är den primära
// gränsen och kör `writeWithFallback` först efter sin egen kontroll.
// delete: ledningen eller den som skickade förfrågan.
//
// GDPR § 5: `items` kan bära grundarnamn/andel/engagemang (samma uppgifter
// som teamet på bolagskortet, berättigat intresse: statsstödskontroll) och
// fri motiveringstext (personnummer-saneras på skrivvägen). Båda
// kollektionerna är DENYLISTADE i lib/ai/redaction.ts. `message` är
// controllerns text till mottagaren. `cascadeDelete` på tenant/startup
// (art. 17); användarrelationer nollställs. Riskklass n/a (ingen AI).
// Speglas i setup-via-api.mjs (defs + FORCE_CREATE_RULES) och asserteras i
// verify-baseline.mjs (must-exist, MUST_BE_STAFF_OR_OBSERVER resp.
// MUST_SCOPE_TO_MEMBER).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const BODY_TENANT = '@request.body.tenant = @request.auth.tenant';
const STAFF4 =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const MEMBER_OF_STARTUP = '(@request.auth.roles:each ?= "startup_member" && @request.auth.linked_startups:each ?= startup)';
const MEMBER_LOCKED_FIELDS = ['tenant', 'startup', 'screening', 'requested_by', 'recipient_kind', 'recipient', 'message', 'due_at', 'closed_by', 'closed_at']
  .map((f) => `@request.body.${f}:isset = false`)
  .join(' && ');

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const screenings = new Collection({
      id: 'startup_screenings_collection',
      name: 'startup_screenings',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
        { name: 'startup', type: 'relation', required: true, collectionId: startupsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
        { name: 'org_nr', type: 'text', required: false, max: 20 },
        { name: 'subject_name', type: 'text', required: false, max: 200 },
        { name: 'mode', type: 'select', required: true, maxSelect: 1, values: ['register', 'saved'] },
        { name: 'provider', type: 'text', required: false, max: 60 },
        // MÅSTE spegla StateAidOutcome / VinnovaOutcome / ScreeningVerdict i
        // packages/shared/src/excellence-screening.ts.
        {
          name: 'state_aid_outcome',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['art22_possible', 'de_minimis', 'not_eligible', 'undetermined']
        },
        { name: 'vinnova_outcome', type: 'select', required: true, maxSelect: 1, values: ['in_target_possible', 'not_in_target', 'undetermined'] },
        { name: 'excellence_verdict', type: 'select', required: true, maxSelect: 1, values: ['yes', 'no', 'unknown'] },
        { name: 'summary', type: 'json', required: false, maxSize: 200000 },
        { name: 'assessed_by', type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
        { name: 'assessed_at', type: 'date', required: false },
        { name: 'file', type: 'file', required: false, maxSelect: 1, maxSize: 15000000, mimeTypes: ['application/pdf'], protected: true },
        { name: 'filename', type: 'text', required: false, max: 200 }
      ],
      indexes: [
        'CREATE INDEX idx_startup_screenings_tenant ON startup_screenings (tenant)',
        'CREATE INDEX idx_startup_screenings_startup_at ON startup_screenings (startup, assessed_at)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${BODY_TENANT} && @request.body.assessed_by = @request.auth.id`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
    });
    app.save(screenings);

    const requests = new Collection({
      id: 'screening_requests_collection',
      name: 'screening_requests',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
        { name: 'startup', type: 'relation', required: true, collectionId: startupsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
        { name: 'screening', type: 'relation', required: false, collectionId: 'startup_screenings_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
        { name: 'requested_by', type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
        // MÅSTE spegla SCREENING_REQUEST_RECIPIENTS / SCREENING_REQUEST_STATUSES
        // i packages/shared/src/excellence-requests.ts.
        { name: 'recipient_kind', type: 'select', required: true, maxSelect: 1, values: ['coach', 'startup'] },
        { name: 'recipient', type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
        { name: 'message', type: 'text', required: false, max: 2000 },
        { name: 'items', type: 'json', required: false, maxSize: 100000 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'partially_answered', 'answered', 'closed'] },
        { name: 'due_at', type: 'date', required: false },
        { name: 'answered_at', type: 'date', required: false },
        { name: 'closed_by', type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
        { name: 'closed_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_screening_requests_tenant_status ON screening_requests (tenant, status)',
        'CREATE INDEX idx_screening_requests_startup ON screening_requests (startup)',
        'CREATE INDEX idx_screening_requests_recipient ON screening_requests (recipient)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || (${MEMBER_OF_STARTUP} && recipient_kind = "startup"))`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || (${MEMBER_OF_STARTUP} && recipient_kind = "startup"))`,
      createRule: `${ANY_AUTH} && ${BODY_TENANT} && @request.body.requested_by = @request.auth.id`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF4} || (${MEMBER_OF_STARTUP} && recipient_kind = "startup" && ${MEMBER_LOCKED_FIELDS}))`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${LEAD} || @request.auth.id = requested_by)`
    });
    return app.save(requests);
  },
  (app) => {
    for (const name of ['screening_requests', 'startup_screenings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // redan borta
      }
    }
  }
);
