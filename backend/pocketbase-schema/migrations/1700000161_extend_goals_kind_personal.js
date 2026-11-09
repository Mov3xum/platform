/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 42 — Övergripande vs personliga mål. Ett mål är antingen
// ÖVERGRIPANDE (organisation/team, sätts av ledningen) eller PERSONLIGT
// (en enskild medarbetares eget mål, `owner_user`). Personliga mål får
// ändras/tas bort av ägaren själv utöver ledningen — speglas i update-/
// deleteRule (skalär `=` mot single-relation, § 21.3: aldrig bart `?=`).
//
// Select-värdena MÅSTE spegla GOAL_KINDS i packages/shared/src/goals.ts.
// Backfill: alla befintliga mål blir `overall` (så var de tänkta). Fail-soft
// om målstyrningen (1700000159) saknas på instansen.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const LEAD_OR_OWNER = `(${STAFF_OR_LEAD} || @request.auth.id = owner_user)`;

migrate(
  (app) => {
    let goals;
    try {
      goals = app.findCollectionByNameOrId('goals');
    } catch (e) {
      // Målstyrningen är inte migrerad ännu — 1700000159 skapar kollektionen.
      return;
    }
    const usersCol = app.findCollectionByNameOrId('users');
    let changed = false;
    if (!goals.fields.getByName('kind')) {
      goals.fields.add(
        new Field({ name: 'kind', type: 'select', required: false, maxSelect: 1, values: ['overall', 'personal'] })
      );
      changed = true;
    }
    if (!goals.fields.getByName('owner_user')) {
      goals.fields.add(
        new Field({
          name: 'owner_user',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
      changed = true;
    }
    const updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD_OR_OWNER}`;
    if (String(goals.updateRule ?? '') !== updateRule) {
      goals.updateRule = updateRule;
      changed = true;
    }
    if (String(goals.deleteRule ?? '') !== updateRule) {
      goals.deleteRule = updateRule;
      changed = true;
    }
    if (changed) app.save(goals);

    // Backfill: befintliga mål är övergripande.
    for (const row of app.findAllRecords('goals')) {
      if (String(row.get('kind') || '')) continue;
      row.set('kind', 'overall');
      app.save(row);
    }
  },
  (app) => {
    try {
      const goals = app.findCollectionByNameOrId('goals');
      const kind = goals.fields.getByName('kind');
      if (kind) goals.fields.removeById(kind.id);
      const owner = goals.fields.getByName('owner_user');
      if (owner) goals.fields.removeById(owner.id);
      const rule = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`;
      goals.updateRule = rule;
      goals.deleteRule = rule;
      app.save(goals);
    } catch (e) {
      /* ignore */
    }
  }
);
