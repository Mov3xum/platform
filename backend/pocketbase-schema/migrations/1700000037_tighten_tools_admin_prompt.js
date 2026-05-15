/// <reference path="../pb_data/types.d.ts" />

// Skärper updateRule på tools så att systemprompt (prompt_template) och
// modellval (model) endast kan ändras av admin. Övriga staff
// (incubator_lead) kan fortfarande uppdatera metadata men inte de
// AI-styrande fälten.
//
// Använder PocketBase `@request.data.<field>:isset`-syntax: regeln
// passerar om antingen användaren är admin, ELLER ingen av de skyddade
// fälten är med i payload.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const ADMIN_ONLY = '@request.auth.roles ?= "admin"';
const STAFF_NON_ADMIN = '@request.auth.roles ?= "incubator_lead"';
const PROMPT_NOT_TOUCHED =
  '(@request.data.prompt_template:isset = false && @request.data.model:isset = false)';

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');

    // Admin kan göra allt; incubator_lead får uppdatera så länge
    // prompt_template/model inte skickas i payload.
    collection.updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && (${ADMIN_ONLY} || (${STAFF_NON_ADMIN} && ${PROMPT_NOT_TOUCHED}))`;

    // Skapa: båda admin och incubator_lead, men incubator_lead får inte
    // sätta prompt_template/model vid create.
    collection.createRule = `${ANY_AUTH} && ${TENANT_MATCH} && (${ADMIN_ONLY} || (${STAFF_NON_ADMIN} && ${PROMPT_NOT_TOUCHED}))`;

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
