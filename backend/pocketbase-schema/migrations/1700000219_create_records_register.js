/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 60 — Diarium, informationshanteringsplan och arkivförteckning.
//
//   record_types         informationshanteringsplanen: en rad per handlingstyp
//   register_cases       ärenden med löpnummer per år (2026/0042)
//   register_entries     handlingar i ärendet (2026/0042-3) med kontrollsumma
//   register_disclosures logg över begäran om utlämnande och utfall
//   archive_profiles     arkivbeskrivningen (en rad per tenant)
//   archive_versions     fastställda versioner av plan + förteckning
//
// ALLA skrivregler är null: bara servern skriver (den cachade superusern,
// EFTER rollkontroll i lib/core/write/register.ts). Ingen användartoken kan
// skapa, ändra eller ta bort en diariepost — nummerserien och kontrollsummorna
// går därmed inte att manipulera via API:t. Rättelser görs som makulering
// (voided_*), aldrig radering. Läsning: Movexum-personal + observer i tenanten.
//
// `startup` har ingen cascade: diariet överlever att ett bolagskort tas bort.
// Fältet heter `register_case` (inte `case`, som är reserverat i SQL).
// Autodate explicit (§ 28.5). Speglas i scripts/setup-via-api.mjs och
// asserteras i verify-baseline.mjs. Enum-värdena MÅSTE spegla
// packages/shared/src/records-register.ts. Oföränderlig migration.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const READ = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`;

const NAMES = ['record_types', 'register_cases', 'register_entries', 'register_disclosures', 'archive_profiles', 'archive_versions'];

migrate(
  (app) => {
    const exists = (name) => {
      try {
        app.findCollectionByNameOrId(name);
        return true;
      } catch (e) {
        return false;
      }
    };
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const created = { name: 'created', type: 'autodate', onCreate: true, onUpdate: false };
    const updated = { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true };
    const tenant = { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 };
    const user = (name) => ({ name, type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 });
    const text = (name, max, required) => ({ name, type: 'text', required: Boolean(required), max });
    const rules = { listRule: READ, viewRule: READ, createRule: null, updateRule: null, deleteRule: null };

    if (!exists('record_types')) {
      app.save(
        new Collection({
          id: 'record_types_collection',
          name: 'record_types',
          type: 'base',
          fields: [
            created,
            updated,
            tenant,
            text('key', 40, true),
            text('label', 120, true),
            text('process', 80, true),
            { name: 'direction', type: 'select', required: true, maxSelect: 1, values: ['incoming', 'outgoing', 'created'] },
            text('trigger', 300),
            { name: 'handling', type: 'select', required: true, maxSelect: 1, values: ['register', 'ordered', 'minor'] },
            { name: 'secrecy_possible', type: 'bool', required: false },
            text('secrecy_basis', 300),
            { name: 'retention', type: 'select', required: true, maxSelect: 1, values: ['preserve', 'dispose'] },
            { name: 'retention_months', type: 'number', required: false, min: 0, max: 1200, onlyInt: true },
            text('legal_basis', 400),
            text('storage', 200),
            text('source_collection', 60),
            { name: 'sort_order', type: 'number', required: false, onlyInt: true },
            { name: 'active', type: 'bool', required: false },
            { name: 'confirmed', type: 'bool', required: false },
            { name: 'confirmed_at', type: 'date', required: false },
            user('confirmed_by'),
            user('updated_by')
          ],
          indexes: ['CREATE UNIQUE INDEX idx_record_types_tenant_key ON record_types (tenant, key)'],
          ...rules
        })
      );
    }

    if (!exists('register_cases')) {
      app.save(
        new Collection({
          id: 'register_cases_collection',
          name: 'register_cases',
          type: 'base',
          fields: [
            created,
            updated,
            tenant,
            { name: 'year', type: 'number', required: true, min: 2000, max: 2200, onlyInt: true },
            { name: 'seq', type: 'number', required: true, min: 1, onlyInt: true },
            text('number', 20, true),
            text('title', 200, true),
            text('type_key', 40),
            text('process', 80),
            text('counterpart', 160),
            text('source_collection', 60),
            text('source_id', 40),
            { name: 'startup', type: 'relation', required: false, collectionId: startupsCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
            { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'closed'] },
            { name: 'opened_at', type: 'date', required: false },
            { name: 'closed_at', type: 'date', required: false },
            user('closed_by'),
            user('created_by')
          ],
          indexes: [
            'CREATE UNIQUE INDEX idx_register_cases_number ON register_cases (tenant, year, seq)',
            "CREATE UNIQUE INDEX idx_register_cases_source ON register_cases (tenant, source_collection, source_id) WHERE source_id != ''",
            'CREATE INDEX idx_register_cases_startup ON register_cases (startup)'
          ],
          ...rules
        })
      );
    }
    const casesCol = app.findCollectionByNameOrId('register_cases');

    if (!exists('register_entries')) {
      app.save(
        new Collection({
          id: 'register_entries_collection',
          name: 'register_entries',
          type: 'base',
          fields: [
            created,
            updated,
            tenant,
            { name: 'register_case', type: 'relation', required: true, collectionId: casesCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
            { name: 'seq', type: 'number', required: true, min: 1, onlyInt: true },
            text('designation', 30, true),
            text('type_key', 40, true),
            text('type_label', 120),
            { name: 'direction', type: 'select', required: true, maxSelect: 1, values: ['incoming', 'outgoing', 'created'] },
            text('title', 200, true),
            text('counterpart', 160),
            { name: 'document_date', type: 'date', required: false },
            { name: 'registered_at', type: 'date', required: true },
            text('source_collection', 60),
            text('source_id', 40),
            text('source_event', 60),
            text('document_hash', 80),
            text('content_hash', 80, true),
            { name: 'snapshot', type: 'json', required: false, maxSize: 100000 },
            { name: 'secrecy', type: 'bool', required: false },
            text('secrecy_basis', 300),
            { name: 'retention', type: 'select', required: false, maxSelect: 1, values: ['preserve', 'dispose'] },
            { name: 'retention_months', type: 'number', required: false, min: 0, max: 1200, onlyInt: true },
            { name: 'via', type: 'select', required: true, maxSelect: 1, values: ['auto', 'manual', 'backfill'] },
            user('registered_by'),
            text('note', 500),
            { name: 'voided_at', type: 'date', required: false },
            user('voided_by'),
            text('void_reason', 300)
          ],
          indexes: [
            'CREATE UNIQUE INDEX idx_register_entries_seq ON register_entries (tenant, register_case, seq)',
            "CREATE UNIQUE INDEX idx_register_entries_source ON register_entries (tenant, source_collection, source_id, source_event) WHERE source_id != ''",
            'CREATE INDEX idx_register_entries_registered ON register_entries (tenant, registered_at)',
            'CREATE INDEX idx_register_entries_type ON register_entries (tenant, type_key)'
          ],
          ...rules
        })
      );
    }
    const entriesCol = app.findCollectionByNameOrId('register_entries');

    if (!exists('register_disclosures')) {
      app.save(
        new Collection({
          id: 'register_disclosures_collection',
          name: 'register_disclosures',
          type: 'base',
          fields: [
            created,
            updated,
            tenant,
            { name: 'register_case', type: 'relation', required: false, collectionId: casesCol.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
            { name: 'entry', type: 'relation', required: false, collectionId: entriesCol.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
            { name: 'requested_at', type: 'date', required: true },
            text('request_summary', 400, true),
            { name: 'outcome', type: 'select', required: true, maxSelect: 1, values: ['released', 'partial', 'denied'] },
            text('secrecy_basis', 300),
            text('note', 600),
            user('handled_by')
          ],
          indexes: ['CREATE INDEX idx_register_disclosures_tenant ON register_disclosures (tenant, requested_at)'],
          ...rules
        })
      );
    }

    if (!exists('archive_profiles')) {
      app.save(
        new Collection({
          id: 'archive_profiles_collection',
          name: 'archive_profiles',
          type: 'base',
          fields: [created, updated, tenant, { name: 'sections', type: 'json', required: false, maxSize: 100000 }, user('updated_by')],
          indexes: ['CREATE UNIQUE INDEX idx_archive_profiles_tenant ON archive_profiles (tenant)'],
          ...rules
        })
      );
    }

    if (!exists('archive_versions')) {
      app.save(
        new Collection({
          id: 'archive_versions_collection',
          name: 'archive_versions',
          type: 'base',
          fields: [
            created,
            updated,
            tenant,
            { name: 'version', type: 'number', required: true, min: 1, onlyInt: true },
            { name: 'established_at', type: 'date', required: true },
            user('established_by'),
            text('note', 400),
            { name: 'plan', type: 'json', required: false, maxSize: 500000 },
            { name: 'inventory', type: 'json', required: false, maxSize: 500000 },
            { name: 'description', type: 'json', required: false, maxSize: 100000 },
            text('content_hash', 80, true)
          ],
          indexes: ['CREATE UNIQUE INDEX idx_archive_versions_tenant_version ON archive_versions (tenant, version)'],
          ...rules
        })
      );
    }
  },
  (app) => {
    for (const name of NAMES.slice().reverse()) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        // redan borta
      }
    }
  }
);
