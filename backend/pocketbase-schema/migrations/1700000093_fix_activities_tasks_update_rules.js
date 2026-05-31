/// <reference path="../pb_data/types.d.ts" />

// PocketBase v0.23 update/delete-rule-evaluering har samma intermittenta
// bugg som vi redan åtgärdat för createRules (1700000049) och för
// workshop_areas update/delete (1700000086): uttryck som refererar ett
// relations-fält på posten (`@request.auth.tenant = tenant` resp.
// `@request.auth.tenant = startup.tenant`) eller använder `?=`-operatorn
// mot multi-select-fältet @request.auth.roles failar sporadiskt med
// "sql: no rows in result set" eller en tom 400 — trots korrekt roll-/
// tenant-data.
//
// Symptom: drag-and-drop i "Min översikt"-boarden (/inkorg) persisterade
// aldrig. updateTaskStatusAction/updateActivityStatusAction körde en
// PB-write vars updateRule tyst nekades, useOptimistic rullade tillbaka
// kortet → "kortet hoppar tillbaka till Att göra". Superuser-fallbacken
// fanns men kräver POCKETBASE_SUPERUSER_*-credentials i miljön; saknas de
// failar flytten ändå.
//
// activities skapades i 1700000008, tasks i 1700000077 — båda med
// update/deleteRules på den buggiga formen:
//   activities.updateRule:
//     @request.auth.id != "" && @request.auth.tenant = startup.tenant
//       && (?= roller || @request.auth.id = owner)
//   tasks.updateRule:
//     @request.auth.id != "" && @request.auth.tenant = tenant
//       && (?= roller || @request.auth.id = owner)
//
// Lösning (samma som 1700000049/1700000086): ta bort relations-referensen
// och `?=`-roll-checkarna. Roll-, ägar- och tenant-enforcement görs redan
// i applikationslagret — updateTaskStatusAction/updateActivityStatusAction
// kör `hasRole(...)` och verifierar att posten tillhör `user.tenant`
// (via startup för activities) innan PB-anropet. Defense-in-depth-
// degradering med samma motivering som 1700000049 (httpOnly-auth, PB bara
// nåbar från web-appen, server actions blockerar fel-rollade users).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';

const RESILIENT_RULE = `${ANY_AUTH} && ${ANY_TENANT}`;

const STAFF_OR_OWNER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.id = owner)';

const PREVIOUS_ACTIVITIES_RULE = `${ANY_AUTH} && @request.auth.tenant = startup.tenant && ${STAFF_OR_OWNER}`;
const PREVIOUS_TASKS_UPDATE_RULE = `${ANY_AUTH} && @request.auth.tenant = tenant && ((@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor") || @request.auth.id = owner)`;
const PREVIOUS_TASKS_DELETE_RULE = `${ANY_AUTH} && @request.auth.tenant = tenant && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.id = owner)`;

migrate(
  (app) => {
    const activities = app.findCollectionByNameOrId('activities');
    activities.updateRule = RESILIENT_RULE;
    activities.deleteRule = RESILIENT_RULE;
    app.save(activities);

    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.updateRule = RESILIENT_RULE;
    tasks.deleteRule = RESILIENT_RULE;
    app.save(tasks);
  },
  (app) => {
    const activities = app.findCollectionByNameOrId('activities');
    activities.updateRule = PREVIOUS_ACTIVITIES_RULE;
    activities.deleteRule = PREVIOUS_ACTIVITIES_RULE;
    app.save(activities);

    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.updateRule = PREVIOUS_TASKS_UPDATE_RULE;
    tasks.deleteRule = PREVIOUS_TASKS_DELETE_RULE;
    app.save(tasks);
  }
);
