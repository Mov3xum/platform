/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 55.9 — Bilder i e-postkampanjer.
//
//   email_media   uppladdade bilder (PNG/JPG/WEBP/GIF) som RIKTIGA PocketBase-
//                 filer, refererade från kampanjernas bildblock med en
//                 app-relativ sökväg (/api/public/e/bild/<id>/<fil>) som
//                 serveras av appens egen origin-proxy — mejlklienten ser
//                 bara appens domän (samma som länkarna), aldrig PB-hosten.
//
// Samma mönster som org_post_media (§ 37.6) / workshop_media (§ 18.2): route
// handler (inte server action → inte bunden av bodySizeLimit), bilden skalas
// ned i webbläsaren före uppladdning. Bilderna är staff-skapat
// marknadsmaterial (ingen PII; UI varnar) och är PUBLIKA via URL — den som
// har mejlet har bilden. list/view = staff/observer (en bolagsmedlem har inget
// med kampanjbiblioteket att göra); createRule refererar BARA auth-fält
// (§ 21.3 — rollen enforce:as i route-handlern) och pinnar tenant (§ 21.8).
// Autodate explicit (§ 28.5). Riskklass n/a — ingen AI-inferens. Nytt,
// oföränderligt filnummer (§ 10.3). Speglas i scripts/setup-via-api.mjs,
// asserteras i verify-baseline.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    const media = new Collection({
      id: 'email_media_collection',
      name: 'email_media',
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
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 8388608, // 8 MB — MÅSTE spegla EMAIL_IMAGE_MAX_BYTES i packages/shared/src/email-media.ts
          // MÅSTE spegla EMAIL_IMAGE_MIMES i packages/shared/src/email-media.ts.
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          thumbs: ['600x0', '1200x0']
        },
        { name: 'name', type: 'text', required: false, max: 200 },
        { name: 'mime', type: 'text', required: false, max: 150 },
        { name: 'size_bytes', type: 'number', required: false, min: 0 },
        { name: 'width', type: 'number', required: false, min: 0 },
        { name: 'height', type: 'number', required: false, min: 0 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: ['CREATE INDEX idx_email_media_tenant ON email_media (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER_EACH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER_EACH}`,
      createRule: `${ANY_AUTH} && @request.auth.tenant != "" && @request.body.tenant = @request.auth.tenant`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_EACH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_EACH}`
    });
    app.save(media);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('email_media'));
    } catch (e) {
      /* ignore */
    }
  }
);
