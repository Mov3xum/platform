/// <reference path="../pb_data/types.d.ts" />

// org_knowledge — TENANT-BRED kunskapsbas (CLAUDE.md § 26). Till skillnad från
// `tool_knowledge` (§ 9.11), som är bunden till EN agent, gäller den här
// kollektionen hela tenanten: Movexum-personal laddar upp verksamhetsmaterial
// (processbeskrivningar, mallar, policys, exporterade presentationer m.m.) en
// gång, och AI-chatten kan söka i det via `search_knowledge` (lib/ai/tools.ts)
// SAMTIDIGT som den läser databasen — i samma agent-loop.
//
// Texten extraheras EN gång vid uppladdning (samma pipe som tool_knowledge,
// lib/ai/knowledge.ts), saneras (personnummer → [REDACTED]) och cachas i
// `extracted_text`. Den chunkas + embeddas sedan till `org_knowledge_chunks`
// (migration 1700000119) för semantisk sökning (RAG, EU-suveränt via
// mistral-embed).
//
// Compliance:
// - GDPR § 5 dataminimering — referensfiler kan inte fält-whitelistas (fritext),
//   så skyddet är: staff-only uppladdning (enforce:as i route/server-action),
//   personnummer-sanering vid extraktion, storlekstak, varningsbanner i UI:t.
// - GDPR art. 17 — `tenant` cascadeDelete=false (matchar övriga collections);
//   städas i tenant-erasure-flödet. Chunkar cascade-raderas med sin källa.
// - EU AI Act art. 13 — vilka källor som matade en körning loggas i
//   tool_runs.input.knowledge_used (parallellt med web_sources/tool_knowledge).
// - § 9.3 / § 10.2 — `org_knowledge` + `org_knowledge_chunks` är DENYLISTADE i
//   lib/ai/redaction.ts → det generiska `query_collection` exponerar dem aldrig.
//   Innehållet når AI ENBART via det kurerade `search_knowledge`-verktyget.
// - § 21 isolering — list/view = staff/observer-only (rena startup_members har
//   ingen dashboardchatt och ska inte läsa tenant-bred kunskapsbas).
// - § 21.3 / § 18.2 — createRule har INGEN roll-check och INGEN `= tenant`-join
//   (PB v0.23.4-bugg); rollen enforce:as i route/server-action. update/delete
//   använder `:each ?=` (membership) som migration 1700000106 kräver.

const ANY_AUTH = '@request.auth.id != ""';
const HAS_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    const collection = new Collection({
      id: 'org_knowledge_col',
      name: 'org_knowledge',
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
        {
          name: 'title',
          type: 'text',
          required: false,
          max: 300
        },
        {
          name: 'filename',
          type: 'text',
          required: true,
          min: 1,
          max: 300
        },
        {
          name: 'mime',
          type: 'text',
          required: false,
          max: 120
        },
        {
          name: 'size_bytes',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          // Originalfilen, tenant-isolerad. Whitelist matchar extraktionspipen
          // (PDF/text/markdown/csv/xlsx). PPTX/DOCX-extraktion är inte i scope
          // ännu (dokumenterad uppföljning) — exportera presentationer till PDF.
          name: 'file',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 26214400, // 25 MB
          mimeTypes: [
            'application/pdf',
            'text/plain',
            'text/markdown',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ]
        },
        {
          // Cachad, sanerad text — källa för chunkning + nyckelords-fallback.
          // Cappas i extraktionssteget (lib/ai/knowledge.ts) till ~300 KB.
          name: 'extracted_text',
          type: 'text',
          required: false,
          max: 320000
        },
        {
          name: 'char_count',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          // True om personnummer-saneringen ändrade texten (audit/transparens).
          name: 'redacted',
          type: 'bool',
          required: false
        },
        {
          // Frivillig ämnesetikett (samma taxonomi som /filer, § 24).
          name: 'topic',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: [
            'affarsplan_strategi',
            'finansiering_kapital',
            'hallbarhet_esg',
            'internationalisering',
            'pitch_material',
            'juridik_avtal',
            'rapporter_uppfoljning',
            'osorterat'
          ]
        },
        {
          // True när chunkning + embeddings byggts (org_knowledge_chunks).
          name: 'indexed',
          type: 'bool',
          required: false
        },
        {
          name: 'chunk_count',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          // Reserverat för framtida SharePoint-sync (extern fil-id/eTag) så
          // synken blir idempotent. Tomt för manuella uppladdningar.
          name: 'source_ref',
          type: 'text',
          required: false,
          max: 300
        },
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
        'CREATE INDEX idx_org_knowledge_tenant ON org_knowledge (tenant)',
        'CREATE INDEX idx_org_knowledge_topic ON org_knowledge (topic)'
      ],
      // list/view: staff/observer i tenanten. create: bara auth + har tenant
      // (ingen roll-check/tenant-join, § 21.3 — rollen enforce:as i route/
      // server-action). update/delete: staff i tenanten (`:each ?=`, § 21.3).
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${HAS_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge');
    return app.delete(collection);
  }
);
