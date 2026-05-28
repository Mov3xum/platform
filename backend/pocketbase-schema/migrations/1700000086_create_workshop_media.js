/// <reference path="../pb_data/types.d.ts" />

// Lagrar workshop-media (filmer/bilder) som RIKTIGA PocketBase-filer i stället
// för base64 i workshops.modules-JSON:en. Base64 blåste upp posten ~33 % och
// fick stora videos att fallera. Blocken refererar nu bara en kort fil-URL.
//
// Filerna serveras via tokenlös publik URL (samma mönster som tenant-logos /
// avatarer i auth.server.ts) → fungerar direkt i <video>/<img>. Posterna är
// staff-skapade utbildningsresurser (ej PII). createRule refererar BARA
// auth-fält (ingen `= tenant`-join) för att undvika PB v0.23:s rule-eval-bugg
// (se verify-baseline.mjs); tenant-isolation enforce:as på list/view + i koden.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'workshop_media_collection',
      name: 'workshop_media',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
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
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['video', 'image']
        },
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 262144000, // 250 MB — rymmer "rätt stora videos"
          mimeTypes: [
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska',
            'video/mpeg',
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif'
          ],
          thumbs: []
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
        }
      ],
      indexes: ['CREATE INDEX idx_workshop_media_tenant ON workshop_media (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_media');
    return app.delete(collection);
  }
);
