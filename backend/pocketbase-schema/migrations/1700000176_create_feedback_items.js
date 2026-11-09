/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 49 — Önskemål & buggar: intern backlog där användarna i
// systemet lägger upp kort (bugg / ny funktion / ändring / fråga) kopplade
// till den del av plattformen de rör. Ledningen (admin/incubator_lead)
// svarar (`answer`) och klarmarkerar (`status = done`).
//
// RLS: list/view = staff/observer-only i tenanten (intern arbetsyta för
// Movexum-personal; bolagsmedlemmar når inte modulen). createRule refererar
// BARA auth-fält (§ 21.3) — rollen enforce:as i server-actionen. Update:
// författaren (redigera sitt kort) eller ledningen (svara/klarmarkera) —
// fältgränsen (vem får skriva `answer`/`status`) ligger i koden. Delete:
// författaren eller ledningen. Multi-värde-auth-fält matchas med
// `:each ?=` (§ 21.3). Autodate explicit (§ 28.5).
//
// `area` är TEXT (inte select): listan över plattformens delar
// (`FEEDBACK_AREAS` i packages/shared/src/feedback.ts) ska kunna växa när en
// ny sida byggs utan att kräva en migration; valideringen ligger i koden.
// `kind`/`status` är select och MÅSTE spegla FEEDBACK_KINDS/FEEDBACK_STATUSES.
//
// PII: kort och svar är fritext från personalen och personnummer-saneras på
// skrivvägen (§ 15.6). `author`/`answered_by`/`done_by` är interna
// användarrelationer (visningsnamn, aldrig e-post). Riskklass n/a.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'feedback_items_collection',
      name: 'feedback_items',
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
          name: 'author',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: true, min: 1, max: 160 },
        { name: 'description', type: 'text', required: true, min: 1, max: 5000 },
        // MÅSTE spegla FEEDBACK_KINDS i packages/shared/src/feedback.ts.
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['bug', 'feature', 'change', 'question']
        },
        // Nyckel ur FEEDBACK_AREAS (validerad i koden, fri text i schemat).
        { name: 'area', type: 'text', required: true, min: 1, max: 40 },
        // MÅSTE spegla FEEDBACK_STATUSES i packages/shared/src/feedback.ts.
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['open', 'answered', 'done']
        },
        { name: 'answer', type: 'text', required: false, max: 5000 },
        {
          name: 'answered_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'answered_at', type: 'date', required: false },
        {
          name: 'done_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'done_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_feedback_items_tenant ON feedback_items (tenant)',
        'CREATE INDEX idx_feedback_items_tenant_status ON feedback_items (tenant, status)',
        'CREATE INDEX idx_feedback_items_author ON feedback_items (author)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = author || ${STAFF_OR_LEAD})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = author || ${STAFF_OR_LEAD})`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('feedback_items'));
    } catch (e) {
      /* ignore */
    }
  }
);
