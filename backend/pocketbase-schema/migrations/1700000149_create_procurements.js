/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39 — Upphandlingar & excellens-insatser. En rad per upphandling
// (t.ex. ramavtalet "AI-stött utvecklings- och leveransstöd för inkubatorbolag")
// som Movexum tecknar med en leverantör. Avrop per bolag ligger i
// `procurement_calloffs` (1700000150) och de regelstyrda uppföljningarna
// expanderas till `tasks` (1700000152) av det delade uppföljningslagret.
//
// RLS: list/view = staff/observer-only (intern inköps-/avtalsdata; en ren
// startup_member ser aldrig andra bolags avrop). createRule refererar BARA
// auth-fält (ingen roll-check, ingen `= tenant`-join) per § 21.3 — rollen
// enforce:as i server-action + skrivlager. Multi-värde-auth-fält matchas med
// `:each ?=` (PB v0.23.4-operatorbugg, § 21.3).
//
// PII: inga personuppgifter — leverantören lagras som företagsnamn, ansvarig
// är en intern användarrelation. Org-nr/kontaktperson lagras medvetet INTE
// (dataminimering § 10.2; kontakt hanteras via CRM:t). PB v0.23 auto-lägger
// INTE created/updated (§ 28.5) → autodate-fälten läggs explicit.

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
    const agreementsCol = app.findCollectionByNameOrId('agreements');

    const collection = new Collection({
      id: 'procurements_collection',
      name: 'procurements',
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
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        { name: 'supplier', type: 'text', required: false, max: 200 },
        // MÅSTE spegla PROCUREMENT_PROCEDURES i packages/shared/src/procurement.ts.
        {
          name: 'procedure',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['ramavtal', 'direktupphandling', 'forenklat_forfarande', 'oppet_forfarande', 'annat']
        },
        { name: 'diarienummer', type: 'text', required: false, max: 80 },
        { name: 'description', type: 'text', required: false, max: 5000 },
        // MÅSTE spegla PROCUREMENT_STATUSES i packages/shared/src/procurement.ts.
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planning', 'tender_open', 'evaluation', 'awarded', 'active', 'ended', 'cancelled']
        },
        { name: 'tender_deadline', type: 'date', required: false },
        { name: 'contract_start', type: 'date', required: false },
        { name: 'contract_end', type: 'date', required: false },
        { name: 'extension_option_months', type: 'number', required: false, onlyInt: true, min: 0, max: 60 },
        { name: 'estimated_value_sek', type: 'number', required: false, min: 0 },
        { name: 'estimated_calloffs', type: 'number', required: false, onlyInt: true, min: 0, max: 1000 },
        { name: 'is_excellence_activity', type: 'bool', required: false },
        // ProcurementCriterion[] — viktade utvärderingskriterier per avrop.
        { name: 'evaluation_criteria', type: 'json', required: false, maxSize: 20000 },
        // CalloffTemplate — upphandlingens egna milstolpar/leveransperiod
        // (dagar från avropsstart + etiketter). Läses ut ur underlaget.
        { name: 'calloff_template', type: 'json', required: false, maxSize: 4000 },
        {
          name: 'agreement',
          type: 'relation',
          required: false,
          collectionId: agreementsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'responsible',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'notes', type: 'text', required: false, max: 5000 },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_procurements_tenant ON procurements (tenant)',
        'CREATE INDEX idx_procurements_tenant_status ON procurements (tenant, status)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('procurements'));
    } catch (e) {
      /* ignore */
    }
  }
);
