/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 57 — Användaraktivitet (`user_activity`): en rad per användare
// med senaste inloggning, antal inloggningar, senast aktiv och ett aggregat
// per MODUL (vilka sidor i sidmenyn personen använder, hur ofta, senast när),
// som stöd för ledningen att hjälpa nya användare igång i plattformen.
//
// Dataminimering (GDPR § 5): aggregatet är per modul — aldrig per sökväg,
// post eller bolag, ingen IP, ingen user agent, inget innehåll. Aktiva dagar
// hålls i ett rullande 90-dagarsfönster och modulrader som inte besökts på
// 365 dagar rensas vid nästa skrivning (packages/shared/src/user-activity.ts).
// Rättslig grund: berättigat intresse (introduktion och stöd till användare
// av ett internt verktyg). Det är INTE ett prestationsmått och får inte
// användas för uppföljning av enskilda medarbetares arbetsinsats (§ 29.7-
// principen för belastning). Personen ser sin egen rad under Mitt konto
// (art. 13/15-transparens).
//
// RLS (§ 21.3): raderna skapas och uppdateras BARA av servern (create/update/
// delete = null — samma mönster som `notifications`), via den cachade
// superusern efter att sessionen verifierats. list/view = ledningen i samma
// tenant (admin/incubator_lead, `:each ?=`) ELLER personen själv (skalär
// `@request.auth.id = user`). Ingen roll-check i createRule (den är null).
//
// Fälten ligger på en egen kollektion, inte på `users`: `users.viewRule` är
// tenant-bred (alla skulle se varandras aktivitet) och fältlåset i
// 1700000174 skulle behöva utökas för varje nytt fält. AI: denylistad i
// lib/ai/redaction.ts. Autodate explicit (§ 28.5). Nytt, oföränderligt
// filnummer (§ 10.3 A.8.32). Speglas i setup-via-api.mjs, asserteras i
// verify-baseline.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const IS_OWNER = '@request.auth.id = user';
const READ_RULE = `${ANY_AUTH} && ((${TENANT_MATCH} && ${LEAD}) || ${IS_OWNER})`;

migrate(
  (app) => {
    let existing = null;
    try {
      existing = app.findCollectionByNameOrId('user_activity');
    } catch (e) {
      existing = null;
    }
    if (existing) return;

    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    const col = new Collection({
      id: 'user_activity_collection',
      name: 'user_activity',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'first_login_at', type: 'date', required: false },
        { name: 'last_login_at', type: 'date', required: false },
        { name: 'login_count', type: 'number', required: false, min: 0, onlyInt: true },
        { name: 'last_seen_at', type: 'date', required: false },
        { name: 'last_module', type: 'text', required: false, max: 40 },
        // { [modulId]: { visits, first_at, last_at } } — aldrig sökvägar eller post-id:n.
        { name: 'modules', type: 'json', required: false, maxSize: 30000 },
        // Svenska kalenderdatum (YYYY-MM-DD) med aktivitet, rullande 90 dagar.
        { name: 'active_days', type: 'json', required: false, maxSize: 4000 }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_user_activity_user ON user_activity (user)',
        'CREATE INDEX idx_user_activity_tenant_seen ON user_activity (tenant, last_seen_at)'
      ],
      listRule: READ_RULE,
      viewRule: READ_RULE,
      createRule: null,
      updateRule: null,
      deleteRule: null
    });
    app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('user_activity');
      app.delete(col);
    } catch (e) {
      /* fanns inte */
    }
  }
);
