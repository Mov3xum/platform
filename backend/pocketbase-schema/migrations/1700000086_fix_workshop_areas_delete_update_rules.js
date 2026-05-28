/// <reference path="../pb_data/types.d.ts" />

// PocketBase v0.23 delete/update-rule-evaluering har samma intermittenta
// bugg som vi redan åtgärdat för createRules i migration 1700000049:
// uttryck som refererar ett relations-fält på posten (`@request.auth.tenant
// = tenant`) eller använder `?=`-operatorn mot multi-select-fältet
// @request.auth.roles failar sporadiskt med "sql: no rows in result set"
// eller en tom 400. Det funkar för en session men failar för en annan med
// IDENTISK roll-/tenant-data.
//
// workshop_areas skapades i 1700000045 med deleteRule/updateRule:
//   @request.auth.id != "" && @request.auth.tenant = tenant && (?= roller)
// createRule fixades i 1700000046/1700000049 men delete/update lämnades kvar
// med den buggiga formen → "radera område" failar intermittent (och faller
// bara tillbaka på superuser om de env-credentials finns).
//
// Lösning (samma som 1700000049): ta bort relations-referensen och
// `?=`-roll-checkarna. Roll- och tenant-enforcement görs redan i
// applikationslagret — deleteWorkshopAreaAction/updateWorkshopAreaAction
// kör `hasRole(user.roles, STAFF_ROLES)` och verifierar att posten tillhör
// `user.tenant` innan PB-anropet. Detta är defense-in-depth-degradering med
// samma motivering som 1700000049 (httpOnly-auth, PB bara nåbar från
// web-appen, server actions blockerar fel-rollade users).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';

const RESILIENT_RULE = `${ANY_AUTH} && ${ANY_TENANT}`;

const PREVIOUS_STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const PREVIOUS_RULE = `@request.auth.id != "" && @request.auth.tenant = tenant && ${PREVIOUS_STAFF_ROLES}`;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_areas');
    collection.deleteRule = RESILIENT_RULE;
    collection.updateRule = RESILIENT_RULE;
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_areas');
    collection.deleteRule = PREVIOUS_RULE;
    collection.updateRule = PREVIOUS_RULE;
    app.save(collection);
  }
);
