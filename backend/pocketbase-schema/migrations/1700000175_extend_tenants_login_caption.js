/// <reference path="../pb_data/types.d.ts" />

// Inloggningssidans bildtext (CLAUDE.md § 48). Mallarna "Bild till vänster/
// höger" och "Färgpanel" visade rubrik + underrubrik BÅDE över bilden och
// vid formuläret — samma text två gånger på skärmen, utan möjlighet att
// skriva något eget över bilden. `login_caption` är texten över bilden, för
// sig: tomt värde ⇒ bilden visar rubrik + underrubrik som förut (en instans
// utan migrationen ändrar aldrig utseendet), satt värde ⇒ bara bildtexten
// (radbrytningar tillåtna, max 200 tecken). Rubrik/underrubrik är fortsatt
// egna, redigerbara fält vid formuläret.
//
// Publik marknadstext utan PII (samma klass som login_headline).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    if (!collection.fields.getByName('login_caption')) {
      collection.fields.add(new Field({ name: 'login_caption', type: 'text', required: false, max: 200 }));
    }
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    const field = collection.fields.getByName('login_caption');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
