/// <reference path="../pb_data/types.d.ts" />

// Inloggningssidans utseende (CLAUDE.md § 48). Admin/incubator_lead väljer
// mall, accentfärg (brand-token), rubrik/underrubrik samt bild och/eller
// video för /login — sidan där ALLA i systemet loggar in. Fälten ligger på
// `tenants` (samma mönster som logo_light/logo_dark, migration 1700000044 —
// ingen separat tenant_settings-collection).
//
// Saknat värde ⇒ appen renderar exakt som före funktionen (`centered`, inga
// media), så en instans som inte kört migrationen ändrar aldrig utseendet;
// server-actionen läser tillbaka posten och rapporterar tydligt när fälten
// saknas (PB släpper okända fält tyst, § 24.4-invarianten).
//
// Bild och video är avsiktligt PUBLIKT material (visas oinloggat) — ingen
// PII. Serveras via samma-origin-proxyn /api/public/login-media/… som
// verifierar filnamnet mot posten (§ 23.7-mönstret).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    const add = (field) => {
      if (!collection.fields.getByName(field.name)) collection.fields.add(new Field(field));
    };

    add({
      name: 'login_layout',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: ['centered', 'split_left', 'split_right', 'cover', 'panel']
    });
    add({
      name: 'login_accent',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: ['morkbla', 'djupbla', 'morklila', 'lila', 'morkgron', 'gron', 'morkorange', 'orange']
    });
    add({ name: 'login_headline', type: 'text', required: false, max: 120 });
    add({ name: 'login_tagline', type: 'text', required: false, max: 300 });
    add({
      name: 'login_image',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 15728640, // 15 MB — samma tak som workshop-/kompassbilder
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
      thumbs: []
    });
    add({
      name: 'login_video',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 209715200, // 200 MB — samma tak som workshop-/kompassvideo
      mimeTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
      thumbs: []
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    for (const name of [
      'login_layout',
      'login_accent',
      'login_headline',
      'login_tagline',
      'login_image',
      'login_video'
    ]) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    return app.save(collection);
  }
);
