/// <reference path="../pb_data/types.d.ts" />

// org_knowledge_chunks — RAG-index för den tenant-breda kunskapsbasen
// (CLAUDE.md § 26). En rad per textstycke ur en `org_knowledge`-källa, med en
// förberäknad embedding-vektor (mistral-embed, FR/EU — EU-suveränt). Vid
// sökning embeddas användarens fråga och rankas mot dessa vektorer (cosine,
// JS-side) så att bara de mest relevanta styckena matas till modellen — det är
// det som låter kunskapsbasen skala bortom prompt-injektionens storlekstak.
//
// Compliance:
// - GDPR § 5 — chunkarna härleds ur redan sanerad `org_knowledge.extracted_text`
//   (personnummer redan bortsanerade uppströms). Ingen ny dataväg.
// - GDPR art. 17 — `source` cascadeDelete=true: raderas källfilen försvinner
//   dess chunkar; `tenant` städas i tenant-erasure-flödet.
// - § 9.3 — DENYLISTAD i lib/ai/redaction.ts (som `org_knowledge`) → når aldrig
//   det generiska `query_collection`. Endast `search_knowledge` läser den.
// - § 21 — list/view staff/observer-only; § 21.3 createRule utan roll-check/
//   tenant-join (rollen enforce:as i route/server-action).

const ANY_AUTH = '@request.auth.id != ""';
const HAS_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const orgKnowledgeCol = app.findCollectionByNameOrId('org_knowledge');

    const collection = new Collection({
      id: 'org_knowledge_chunks_col',
      name: 'org_knowledge_chunks',
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
          name: 'source',
          type: 'relation',
          required: true,
          collectionId: orgKnowledgeCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'chunk_index',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          name: 'text',
          type: 'text',
          required: false,
          max: 8000
        },
        {
          // Embedding-vektor (mistral-embed, 1024 dim) som JSON-array av floats.
          name: 'embedding',
          type: 'json',
          required: false,
          maxSize: 200000
        },
        {
          name: 'token_count',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        }
      ],
      indexes: [
        'CREATE INDEX idx_org_knowledge_chunks_tenant ON org_knowledge_chunks (tenant)',
        'CREATE INDEX idx_org_knowledge_chunks_source ON org_knowledge_chunks (source)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${HAS_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge_chunks');
    return app.delete(collection);
  }
);
