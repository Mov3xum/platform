/// <reference path="../pb_data/types.d.ts" />

// Personligt filarkiv (/filer). Agent-genererade dokument (PPTX/XLSX/DOCX/PDF)
// och egna uppladdningar. STRIKT ägaren-bara — även admin/incubator_lead är
// utestängda (maintainer-beslut: "bara jag kan se").
//
// CLAUDE.md § 10.2 (GDPR): rättslig grund = berättigat intresse. Art. 17:
// owner + tenant cascadeDelete → erasure tar bort filerna. Dokument kan
// innehålla sammanställd data, men bara sådant agenten lagligt fick läsa
// (PII-denylist/maskning i lib/ai/schema.ts gäller uppströms — renderaren
// är ingen ny dataväg). Denylistad i schema.ts så agenter aldrig kan fråga
// detta arkiv.
// § 10.3 (ISO 27001 A.8.9): mime-whitelist + 25 MB tak = input-validering.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = owner';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const threadsCol = app.findCollectionByNameOrId('chat_threads');
    const runsCol = app.findCollectionByNameOrId('tool_runs');

    const collection = new Collection({
      id: 'user_files_col',
      name: 'user_files',
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
          name: 'file',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 26214400, // 25 MB
          mimeTypes: [
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
            'application/vnd.ms-excel',
            'text/plain',
            'text/markdown',
            'text/csv',
            'image/png',
            'image/jpeg',
            'image/webp'
          ]
        },
        { name: 'filename', type: 'text', required: true, max: 255 },
        { name: 'mime', type: 'text', required: false, max: 120 },
        { name: 'size_bytes', type: 'number', required: false },
        {
          name: 'source',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['agent_generated', 'upload']
        },
        {
          name: 'doc_kind',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['pptx', 'xlsx', 'docx', 'pdf', 'other']
        },
        // Ingen cascade — behåll filen även om tråden/körningen raderas.
        {
          name: 'chat_thread',
          type: 'relation',
          required: false,
          collectionId: threadsCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        {
          name: 'tool_run',
          type: 'relation',
          required: false,
          collectionId: runsCol.id,
          cascadeDelete: false,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_uf_owner ON user_files (owner)',
        'CREATE INDEX idx_uf_tenant ON user_files (tenant)',
        'CREATE INDEX idx_uf_owner_created ON user_files (owner, created)'
      ],
      // STRIKT ägaren-bara på ALLA operationer.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('user_files'));
    } catch (e) {
      /* ignore */
    }
  }
);
