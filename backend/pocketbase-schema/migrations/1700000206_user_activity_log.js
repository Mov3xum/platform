/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 36.4 — Användarlogg: senast aktiv & inloggningshistorik.
//
//   users.last_login_at   ← när kontot senast loggade in (lösenord)
//   users.last_active_at  ← när kontot senast gjorde ett inloggat anrop
//                            (hjärtslag med 10 min upplösning, § 36.4)
//   users.login_count     ← antal inloggningar totalt
//   user_login_events     ← en rad per inloggning (tenant, user, method) —
//                            inloggningshistoriken i Inställningar → Användare.
//                            INGEN ip-adress, ingen user agent (dataminimering).
//
// Fälten skrivs BARA av servern (superuser) och låses därför i users
// självservice-regel (samma `@request.body.<fält>:isset = false`-mönster som
// 1700000174) — en användare ska inte kunna skriva om sin egen historik via
// API:t. Kollektionen är lead-only (admin/incubator_lead, samma krets som
// användaradministrationen) för läsning och server-only för skrivning
// (createRule null, § 50.3-mönstret). Gallras av retention_tick efter 365 d.
// Denylistad för AI (lib/ai/redaction.ts). Speglas i setup-via-api.mjs,
// asserteras i verify-baseline.mjs. Oföränderlig migration (§ 10.3 A.8.32).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

const LOCKED_SELF_UPDATE_FIELDS = [
  'roles',
  'tenant',
  'linked_startups',
  'enabled_modules',
  'disabled_modules',
  'verified',
  'email',
  'emailVisibility',
  'last_login_at',
  'last_active_at',
  'login_count'
];

const SELF_UPDATE_RULE =
  '@request.auth.id = id && ' +
  LOCKED_SELF_UPDATE_FIELDS.map((f) => `@request.body.${f}:isset = false`).join(' && ');

const PREVIOUS_SELF_UPDATE_RULE =
  '@request.auth.id = id && ' +
  LOCKED_SELF_UPDATE_FIELDS.slice(0, 8)
    .map((f) => `@request.body.${f}:isset = false`)
    .join(' && ');

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const users = app.findCollectionByNameOrId('users');
    const add = (f) => {
      if (!users.fields.getByName(f.name)) users.fields.add(new Field(f));
    };
    add({ name: 'last_login_at', type: 'date', required: false });
    add({ name: 'last_active_at', type: 'date', required: false });
    add({ name: 'login_count', type: 'number', required: false, min: 0, onlyInt: true });
    users.updateRule = SELF_UPDATE_RULE;
    app.save(users);

    try {
      app.findCollectionByNameOrId('user_login_events');
    } catch (e) {
      const events = new Collection({
        id: 'user_login_events_collection',
        name: 'user_login_events',
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
            collectionId: users.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          },
          // Hur inloggningen skedde — i dag alltid "password". Text (inte
          // select) så en framtida metod (eID) aldrig ger 400.
          { name: 'method', type: 'text', required: false, max: 40 }
        ],
        indexes: [
          'CREATE INDEX idx_user_login_events_tenant_user_created ON user_login_events (tenant, user, created)',
          'CREATE INDEX idx_user_login_events_tenant_created ON user_login_events (tenant, created)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`,
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(events);
    }
  },
  (app) => {
    try {
      const events = app.findCollectionByNameOrId('user_login_events');
      app.delete(events);
    } catch (e) {
      // fanns inte
    }
    const users = app.findCollectionByNameOrId('users');
    for (const n of ['last_login_at', 'last_active_at', 'login_count']) {
      const f = users.fields.getByName(n);
      if (f) users.fields.removeById(f.id);
    }
    users.updateRule = PREVIOUS_SELF_UPDATE_RULE;
    app.save(users);
  }
);
