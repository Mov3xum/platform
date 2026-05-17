/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const RESILIENT_CREATE_RULE = `${ANY_AUTH} && @request.auth.tenant != "" && ${STAFF_ROLES}`;
const PREVIOUS_CREATE_RULE = `${ANY_AUTH} && @request.auth.tenant = tenant && ${STAFF_ROLES}`;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_areas');
    collection.createRule = RESILIENT_CREATE_RULE;
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_areas');
    collection.createRule = PREVIOUS_CREATE_RULE;
    return app.save(collection);
  }
);
