/// <reference path="../pb_data/types.d.ts" />

// user_file_chunks — RAG-index för det PERSONLIGA filarkivet (CLAUDE.md § 27).
// Per-användare och STRIKT ägaren-bara (samma regler som user_files): ett
// embeddat textstycke ur en av ägarens egna filer. Vid sökning embeddas
// ägarens fråga och rankas mot ägarens egna chunkar (cosine, JS-side), så att
// chatten kan svara på frågor om filer användaren själv laddat upp — utan att
// någon annan kommer åt dem.
//
// Compliance:
// - GDPR § 5 — chunkarna härleds ur redan sanerad `user_files.extracted_text`
//   (personnummer bortsanerade uppströms). Ingen ny dataväg.
// - GDPR art. 17 — `owner`/`source` cascadeDelete=true: raderas filen eller
//   användaren försvinner chunkarna; `tenant` cascadeDelete=true (matchar
//   user_files).
// - § 9.3 — DENYLISTAD i lib/ai/redaction.ts (som user_files) → når aldrig
//   query_collection. Endast `search_my_files` (ägar-scopat) läser den.
// - § 21 — STRIKT ägaren-bara på ALLA operationer; ingen staff-läsning.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = owner';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const userFilesCol = app.findCollectionByNameOrId('user_files');

    const collection = new Collection({
      id: 'user_file_chunks_col',
      name: 'user_file_chunks',
      type: 'base',
      fields: [
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
          name: 'owner',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'source',
          type: 'relation',
          required: true,
          collectionId: userFilesCol.id,
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
        'CREATE INDEX idx_user_file_chunks_owner ON user_file_chunks (owner)',
        'CREATE INDEX idx_user_file_chunks_source ON user_file_chunks (source)',
        'CREATE INDEX idx_user_file_chunks_tenant ON user_file_chunks (tenant)'
      ],
      // STRIKT ägaren-bara på ALLA operationer (samma som user_files). OBS:
      // createRule får INTE ha en `= tenant`-join (PB v0.23.4-bugg → 500 vid
      // create; verify-baseline-svepet fäller den). Ägar-skalären räcker;
      // tenant sätts i koden — exakt mönstret user_files fick i 1700000111 (§ 21.3).
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      createRule: `${ANY_AUTH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('user_file_chunks');
    return app.delete(collection);
  }
);
