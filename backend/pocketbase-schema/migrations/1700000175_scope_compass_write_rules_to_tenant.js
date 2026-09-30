/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 21.7 / § 23 — efterskörd 2026-09-30 (säkerhetsgranskning).
//
// Migration 1700000112 tenant-scopade LIST/VIEW på `compass_questions`
// (`module.tenant`), `compass_messages` och `compass_responses`
// (`conversation.tenant`), men UPDATE/DELETE stod kvar från 1700000109 som
// `auth && STAFF` UTAN tenant-villkor. En coach i tenant A kunde därmed — med
// sin egen token direkt mot PB-API:t — ändra eller radera tenant B:s frågor
// (id:n syns på B:s publika /m/-sida), meddelanden och enkätsvar. Nu bär
// update/delete samma förälder-join som list/view. `:each ?=` per § 21.3.

const ANY_AUTH = '@request.auth.id != ""';
const COMPASS_STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';

const RULES = {
  compass_questions: `${ANY_AUTH} && @request.auth.tenant = module.tenant && ${COMPASS_STAFF}`,
  compass_messages: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`,
  compass_responses: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF}`
};
const PREVIOUS = `${ANY_AUTH} && ${COMPASS_STAFF}`;

migrate(
  (app) => {
    for (const [name, rule] of Object.entries(RULES)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue; // compass är migration-only; saknas kollektionen finns inget att scopa
      }
      col.updateRule = rule;
      col.deleteRule = rule;
      app.save(col);
    }
  },
  (app) => {
    for (const name of Object.keys(RULES)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      col.updateRule = PREVIOUS;
      col.deleteRule = PREVIOUS;
      app.save(col);
    }
  }
);
