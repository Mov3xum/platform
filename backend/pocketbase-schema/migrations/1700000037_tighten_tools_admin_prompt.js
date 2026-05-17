/// <reference path="../pb_data/types.d.ts" />

// Skärper create/update på tools till admin-only.
//
// Tidigare försök använde @request.data.<field>:isset, men den syntaxen
// stöds inte i den PocketBase-version vi kör i produktion och gjorde att
// migreringen kraschade. Den här varianten är kompatibel och blockerar
// ändringar av AI-styrande fält för icke-admin.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const ADMIN_ONLY = '@request.auth.roles ?= "admin"';

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');

    collection.updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && ${ADMIN_ONLY}`;
    collection.createRule = `${ANY_AUTH} && ${TENANT_MATCH} && ${ADMIN_ONLY}`;

    return app.save(collection);
  },
  (app) => {
    // Återställ till föregående regler (admin || incubator_lead)
    const STAFF_ROLES =
      '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
    const collection = app.findCollectionByNameOrId('tools');
    collection.updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`;
    collection.createRule = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`;
    return app.save(collection);
  }
);
