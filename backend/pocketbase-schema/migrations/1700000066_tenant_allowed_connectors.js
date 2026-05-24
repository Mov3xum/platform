/// <reference path="../pb_data/types.d.ts" />

// Lägger `allowed_mistral_connectors` (json: lista av connector_id) på
// tenants-collectionen. Admin (server action setTenantAllowedConnectors)
// hanterar listan. Tom array eller saknad = endast default-tillåtna
// connectors (se lib/ai/builtins.ts DEFAULT_ALLOWED).
//
// Mönstret följer befintliga `disabled_modules` på tenants — ingen
// separat tenant_settings-collection.
//
// CLAUDE.md § 9.7 / § 10.1: kostnadsdrivande connectors (code_interpreter,
// image_generation, document_library) måste explicit aktiveras av
// admin innan slutanvändare kan opt:a in.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    collection.fields.add(
      new Field({
        name: 'allowed_mistral_connectors',
        type: 'json',
        required: false,
        maxSize: 2000
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    const field = collection.fields.getByName('allowed_mistral_connectors');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
