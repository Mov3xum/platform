/// <reference path="../pb_data/types.d.ts" />

// Tillåter admin- och incubator_lead-användare att uppdatera tenants via API.
// Tidigare var updateRule = null (endast PocketBase-superuser), vilket innebar
// att applikationsadmins inte kunde spara modulinställningar.
//
// Ny regel:
//   admin          → kan uppdatera alla tenants
//   incubator_lead → kan uppdatera sin egen tenant

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');

    collection.updateRule =
      '@request.auth.id != "" && ' +
      '(@request.auth.roles ?= "admin" || ' +
      '(@request.auth.roles ?= "incubator_lead" && @request.auth.tenant = id))';

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    collection.updateRule = null;
    return app.save(collection);
  }
);
