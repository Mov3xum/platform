/// <reference path="../pb_data/types.d.ts" />

// Excel-arket "ToDo" — polymorf uppgiftslista. En task kan kopplas till:
//   • ett bolag        (`startup`)
//   • en kontakt       (`contact`)
//   • ett event        (`event`)
//   • inget             (fristående tenant-task)
//
// Skiljer sig från `activities` (1700000008) som är HÅRT bundet till
// startup (required + cascadeDelete) och delar utrymme med AI-tool-runs.
// `tasks` är renare "todo"-modell för CRM-arbetsflöden.
//
// `link_kind` markerar vilken polymorf länk som är aktiv — alla tre
// relations-fält är optional, men exakt en av dem ska vara satt när
// `link_kind != 'none'`. Validering sker i server action (UI-lager).
//
// CLAUDE.md § 9.3: titel/typ/status/datum är AI-säkert. `description`
// är fri editor — staff bör undvika PII. Tasks INKLUDERAS INTE i
// default AI-kontext (defense-in-depth); enskilda agenter kan opt-in.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const OWNER_MATCH = '@request.auth.id = owner';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const contactsCol = app.findCollectionByNameOrId('contacts');
    const eventsCol = app.findCollectionByNameOrId('incubator_events');

    const collection = new Collection({
      id: 'tasks_collection',
      name: 'tasks',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        // Vad task:en handlar om — Excel: "Typ".
        // call=samtal, meeting=möte, email, prep=förberedelse,
        // followup=uppföljning, admin=administration, other=övrigt.
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other']
        },
        // Excel: "Beskrivning" — kort titel/sammanfattning.
        { name: 'description', type: 'text', required: true, max: 500 },
        // Detaljerad text — frivillig, för längre kontext.
        { name: 'details', type: 'editor', required: false },
        // Excel: "Startdatum"
        { name: 'starts_at', type: 'date', required: false },
        // Excel: "Slutdatum" — deadline.
        { name: 'due_at', type: 'date', required: false },
        // Excel: "Klardatum"
        { name: 'completed_at', type: 'date', required: false },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['open', 'in_progress', 'blocked', 'done', 'cancelled']
        },
        // Excel: "Ansvarig"
        {
          name: 'owner',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        // Polymorf koppling — Excel: "Kopplad Typ" + "Koppling till ID".
        {
          name: 'link_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['none', 'startup', 'contact', 'event']
        },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'contact',
          type: 'relation',
          required: false,
          collectionId: contactsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'event',
          type: 'relation',
          required: false,
          collectionId: eventsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_tasks_tenant ON tasks (tenant)',
        'CREATE INDEX idx_tasks_owner ON tasks (owner)',
        'CREATE INDEX idx_tasks_status ON tasks (status)',
        'CREATE INDEX idx_tasks_due ON tasks (due_at)',
        'CREATE INDEX idx_tasks_startup ON tasks (startup)',
        'CREATE INDEX idx_tasks_contact ON tasks (contact)',
        'CREATE INDEX idx_tasks_event ON tasks (event)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_ROLES} || ${OWNER_MATCH})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || ${OWNER_MATCH})`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('tasks'));
    } catch (e) {
      /* ignore */
    }
  }
);
