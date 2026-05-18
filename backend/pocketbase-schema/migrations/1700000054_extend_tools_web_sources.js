/// <reference path="../pb_data/types.d.ts" />

// Lägger fältet `web_sources` (JSON-array av källnycklar) på tools-collectionen.
// Tom array eller saknas = ingen web-fetch (default beteende).
// Whitelistade nycklar definieras i `apps/web/src/lib/ai/web.ts` (WEB_SOURCES):
//   breakit, sifted, di_digital, vinnova, eic, almi

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');

    collection.fields.add(
      new Field({
        name: 'web_sources',
        type: 'json',
        required: false,
        maxSize: 2000
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');
    const field = collection.fields.getByName('web_sources');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
