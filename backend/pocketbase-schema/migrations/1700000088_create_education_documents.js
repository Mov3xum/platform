/// <reference path="../pb_data/types.d.ts" />

// Lagrar utbildningsdokument (PDF, Excel, PowerPoint, Word) som staff laddar
// upp under /education/documents och sedan kan tilldela bolag. Filerna lagras
// som RIKTIGA PocketBase-filer (samma mönster som workshop_media,
// migration 1700000086) — inte base64 — och serveras via tokenlös publik URL.
//
// Posterna är staff-skapade utbildningsresurser (ej PII, ingen AI-inferens →
// minimal riskklass, CLAUDE.md § 18.2 resonemang). createRule refererar BARA
// auth-fält (ingen `= tenant`-join) för att undvika PB v0.23:s rule-eval-bugg;
// tenant-isolation enforce:as på list/view + i koden.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'education_documents_collection',
      name: 'education_documents',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          max: 200
        },
        {
          name: 'description',
          type: 'text',
          required: false,
          max: 2000
        },
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 52428800, // 50 MB
          mimeTypes: [
            'application/pdf',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ],
          thumbs: []
        },
        {
          name: 'doc_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pdf', 'excel', 'powerpoint', 'word', 'other']
        },
        {
          name: 'mime',
          type: 'text',
          required: false,
          max: 150
        },
        {
          name: 'size_bytes',
          type: 'number',
          required: false
        },
        {
          name: 'uploaded_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
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
        'CREATE INDEX idx_education_documents_tenant ON education_documents (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('education_documents');
    return app.delete(collection);
  }
);
