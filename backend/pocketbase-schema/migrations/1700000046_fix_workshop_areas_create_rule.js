/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

// Robust createRule: kräver auth, tenant, och staff-roll. Ger tydligt fel om något saknas.
const RESILIENT_CREATE_RULE = `
  @request.auth.id != "" &&
  @request.auth.tenant != "" &&
  (
    @request.auth.roles ?= "admin" ||
    @request.auth.roles ?= "incubator_lead" ||
    @request.auth.roles ?= "coach" ||
    @request.auth.roles ?= "mentor"
  )
`;
// Om du vill vara striktare, byt ut != "" mot = tenant för hård multi-tenant separation.
const PREVIOUS_CREATE_RULE = `
  @request.auth.id != "" &&
  @request.auth.tenant = tenant &&
  (
    @request.auth.roles ?= "admin" ||
    @request.auth.roles ?= "incubator_lead" ||
    @request.auth.roles ?= "coach" ||
    @request.auth.roles ?= "mentor"
  )
`;

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
