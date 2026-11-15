/// <reference path="../pb_data/types.d.ts" />

// Säkerhetsgranskning 2026-11-15 — flyttlås på update-reglerna (CLAUDE.md § 21.8).
//
// Update-reglerna prövade POSTENS nuvarande `tenant`/`startup` men inte det
// värde som skickades in. Verifierat mot PB 0.23.4 lokalt: en coach kunde med
// sin egen token flytta ett bolag till en annan tenant, och en bolagsmedlem
// kunde flytta sin KPI-rad till ett annat bolag och till en annan tenant.
//
// Den här migrationen lägger två lås på VARJE updateRule på en bas-kollektion:
//   - `tenant`-fält: värdet får inte ändras (att skicka samma värde är okej).
//   - `startup`-fält där regeln släpper in bolagsmedlemmar (`linked_startups`):
//     bara Movexum-personal får byta bolag.
//
// ORDAGRANN SPEGEL av withMoveLocks() i scripts/security-rules.mjs (JSVM kan
// inte importera ES-moduler). scripts/security-rules.test.mjs låser att
// låssträngarna är identiska. setup-via-api.mjs lägger samma lås vid varje
// sync och verify-baseline.mjs fäller deployen om ett saknas.
//
// Regelvärden är Go-pekare i JSVM — koercera med String(...) (§ 21.3-läxan
// från 1700000108/1700000127). null = bara superuser och lämnas orört.
// down() tar inte bort låsen (att ta bort dem återinför sårbarheten).

const TENANT_MOVE_LOCK = '(@request.body.tenant:isset = false || @request.body.tenant = tenant)';
const STARTUP_MOVE_LOCK =
  '((@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor") || @request.body.startup:isset = false || @request.body.startup = startup)';

function fieldNamesOf(collection) {
  const names = [];
  const fields = collection.fields;
  for (let i = 0; i < fields.length; i++) names.push(String(fields[i].name));
  return names;
}

function withMoveLocks(rule, fieldNames) {
  if (rule === null || rule === undefined) return null;
  const s = String(rule);
  if (s === '' || s === 'null' || s === 'undefined') return null;
  const locks = [];
  if (fieldNames.indexOf('tenant') >= 0 && s.indexOf(TENANT_MOVE_LOCK) < 0) locks.push(TENANT_MOVE_LOCK);
  if (
    fieldNames.indexOf('startup') >= 0 &&
    s.indexOf('linked_startups') >= 0 &&
    s.indexOf(STARTUP_MOVE_LOCK) < 0
  ) {
    locks.push(STARTUP_MOVE_LOCK);
  }
  if (locks.length === 0) return null;
  return ['(' + s + ')'].concat(locks).join(' && ');
}

migrate(
  (app) => {
    const collections = app.findAllCollections();
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      if (collection.system || String(collection.type) !== 'base') continue;
      const locked = withMoveLocks(collection.updateRule, fieldNamesOf(collection));
      if (locked === null) continue;
      collection.updateRule = locked;
      app.save(collection);
    }
  },
  (_app) => {
    // No-op: att ta bort låsen återinför sårbarheten.
  }
);
