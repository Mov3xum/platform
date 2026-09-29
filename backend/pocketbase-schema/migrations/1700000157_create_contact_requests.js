/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 45.3 — Förfrågan om att använda en kontakt i kontaktboken.
// En kollega (requester) ber kontaktens ägare om bekräftelse att använda
// kontakten för ett SPECIFIKT syfte — t.ex. koppla ihop kontakten med ett
// bolag. Ägaren godkänner eller avböjer; vid godkännande med `startup` skapas
// kopplingen i `startup_contacts` (§ 15.2) och bolaget ser kontakten som
// "delad" på Mitt bolag. Varje rad är ett audit-spår för vad kontakten
// använts till (GDPR art. 5 ändamålsbegränsning) — en avgjord förfrågan är
// slutgiltig; ny användning = ny förfrågan.
//
// RLS: list/view = staff/observer-only i tenanten (kontaktboken är intern;
// bolagsmedlemmar ser DELADE kontakter via en kurerad server-vy efter
// verifierat medlemskap, inte via denna kollektion). createRule refererar
// BARA auth-fält (§ 21.3) — rollen enforce:as i skrivlagret. Update:
// frågaren (återkalla) eller staff (avgöra; ägar-/adminkontrollen ligger i
// koden). Multi-värde-auth-fält matchas med `:each ?=` (§ 21.3).
//
// PII: `purpose`/`decision_note` är fritext från personalen och
// personnummer-saneras på skrivvägen (§ 15.6); inga kontaktuppgifter
// kopieras hit. Autodate explicit (§ 28.5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const contactsCol = app.findCollectionByNameOrId('contacts');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'contact_requests_collection',
      name: 'contact_requests',
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
          name: 'contact',
          type: 'relation',
          required: true,
          collectionId: contactsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'requester',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        // Ägarna vid förfrågningstillfället (snapshot) — de som notifieras.
        {
          name: 'owners',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 20
        },
        // Vad kontakten ska användas till (obligatoriskt, personnummer-sanerat).
        { name: 'purpose', type: 'text', required: true, min: 1, max: 2000 },
        // Valfritt: bolag kontakten ska delas med vid godkännande.
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        // Kontaktens roll gentemot bolaget (blir startup_contacts.role).
        { name: 'startup_role', type: 'text', required: false, max: 100 },
        // MÅSTE spegla CONTACT_REQUEST_STATUSES i packages/shared/src/contacts.ts.
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pending', 'approved', 'declined', 'withdrawn']
        },
        { name: 'decision_note', type: 'text', required: false, max: 2000 },
        {
          name: 'decided_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'decided_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_contact_requests_tenant ON contact_requests (tenant)',
        'CREATE INDEX idx_contact_requests_contact ON contact_requests (contact)',
        'CREATE INDEX idx_contact_requests_tenant_status ON contact_requests (tenant, status)',
        'CREATE INDEX idx_contact_requests_requester ON contact_requests (requester)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = requester || ${STAFF})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('contact_requests'));
    } catch (e) {
      /* ignore */
    }
  }
);
