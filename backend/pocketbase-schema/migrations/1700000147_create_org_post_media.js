/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 37.6 — Anslagstavlan: media (bilder, film, dokument) på inlägg.
//
// 1. `org_post_media` — uppladdade filer som RIKTIGA PocketBase-filer (samma
//    mönster som workshop_media § 18.2: route handler → inte bunden av
//    serverActions.bodySizeLimit; tokenlös publik fil-URL fungerar direkt i
//    <img>/<video>/<a>). Inlägget refererar bara en kort URL + metadata.
// 2. `org_posts.media` — json-lista `OrgPostMedia[]` ({ id, url, kind, name,
//    mime, size_bytes }) — valideras i validateOrgPostInput (max 8, bara URL:er
//    till org_post_media-filer).
//
// Posterna är staff-skapat verksamhetsmaterial (ingen PII; UI varnar). list/
// view = auth + tenant (en bolagsmedlem ser inlägg med audience=all och deras
// media; filen är ändå publik via URL). createRule refererar BARA auth-fält
// (§ 21.3 — rollen enforce:as i route-handlern). Autodate explicit (§ 28.5).
// Riskklass n/a — ingen AI-inferens. Nytt, oföränderligt filnummer (§ 10.3).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    const media = new Collection({
      id: 'org_post_media_collection',
      name: 'org_post_media',
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
          name: 'uploaded_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        // MÅSTE spegla ORG_POST_MEDIA_KINDS i packages/shared/src/org-posts.ts.
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['image', 'video', 'file'] },
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 209715200, // 200 MB (film); bild/dokument cappas hårdare i koden
          // MÅSTE spegla ORG_POST_MEDIA_MIMES i packages/shared/src/org-posts.ts.
          mimeTypes: [
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ],
          thumbs: ['600x0', '1200x0']
        },
        { name: 'name', type: 'text', required: false, max: 200 },
        { name: 'mime', type: 'text', required: false, max: 150 },
        { name: 'size_bytes', type: 'number', required: false, min: 0 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: ['CREATE INDEX idx_org_post_media_tenant ON org_post_media (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_EACH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_EACH}`
    });
    app.save(media);

    const posts = app.findCollectionByNameOrId('org_posts');
    if (!posts.fields.getByName('media')) {
      posts.fields.add(new Field({ name: 'media', type: 'json', required: false, maxSize: 20000 }));
      app.save(posts);
    }
  },
  (app) => {
    try {
      const posts = app.findCollectionByNameOrId('org_posts');
      const f = posts.fields.getByName('media');
      if (f) {
        posts.fields.removeById(f.id);
        app.save(posts);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      app.delete(app.findCollectionByNameOrId('org_post_media'));
    } catch (e) {
      /* ignore */
    }
  }
);
