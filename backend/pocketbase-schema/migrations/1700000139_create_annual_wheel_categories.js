/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30) — DYNAMISKA kategorier per tenant.
//
// Kategorierna (hjulets legend + färg + filter) var tidigare hårdkodade som
// select-värden på `annual_wheel_items.category` (styrelse/ledning/gemensamt).
// Movexum behöver kunna lägga till och ta bort egna kategorier, så de flyttas
// till en egen kollektion:
//
//   annual_wheel_categories:
//     • tenant     ← ägande tenant (cascadeDelete)
//     • key        ← stabil slug som lagras i annual_wheel_items.category
//     • label      ← visningsnamn i legend/filter/editor
//     • token      ← Movexum-brand-färgtoken (§ 2.2 — inga ad-hoc-hex)
//     • sort_order ← ordning i legend/filter
//
// Behörighet: BARA `admin` (Movexums superadmin) får skapa/ändra/radera
// kategorier — enforce:as i server-actionen OCH i update/delete-reglerna med
// `:each ?=` (§ 21.3). createRule refererar bara auth-fält (ingen roll-check,
// ingen `= tenant`-join) för att undvika PB v0.23.4:s rule-eval-buggar; det är
// samma mönster som `annual_wheel_items` (migration 1700000133) och det som
// verify-baseline-svepet kräver.
//
// Läsning är staff/observer-only (§ 21) precis som årshjulet i övrigt — en ren
// startup_member ser inte Movexums interna styrelse-/ledningskalender.
//
// Riskklass n/a: ingen AI-inferens, ingen PII (intern verksamhetsplanering).
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32). Speglas i setup-via-api.mjs +
// verify-baseline.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
// Superadmin = plattformens `admin`-roll (högsta app-rollen, CLAUDE.md § 6).
const SUPERADMIN = '(@request.auth.roles:each ?= "admin")';

// MÅSTE spegla AnnualWheelColorToken i packages/shared/src/annual-wheel.ts.
const COLOR_TOKENS = [
  'morkbla',
  'djupbla',
  'bla',
  'morklila',
  'lila',
  'ljuslila',
  'morkgron',
  'gron',
  'ljusgron',
  'morkgul',
  'gul',
  'morkorange',
  'orange'
];

// Speglar DEFAULT_ANNUAL_WHEEL_CATEGORIES i packages/shared/src/annual-wheel.ts
// (och de tidigare select-värdena) → befintliga poster behåller sin färg.
const SEED_CATEGORIES = [
  { key: 'styrelse', label: 'Styrelse', token: 'gron', sort_order: 0 },
  { key: 'ledning', label: 'Ledning', token: 'gul', sort_order: 1 },
  { key: 'gemensamt', label: 'Gemensamt', token: 'lila', sort_order: 2 }
];

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'annual_wheel_categories_collection',
      name: 'annual_wheel_categories',
      type: 'base',
      fields: [
        // Autodate måste anges explicit — PB v0.23 auto-lägger dem INTE vid
        // `new Collection(...)` (§ 28.5). Utan dem 400:ar varje -created-sort.
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
        { name: 'key', type: 'text', required: true, min: 1, max: 40 },
        { name: 'label', type: 'text', required: true, min: 1, max: 60 },
        { name: 'token', type: 'select', required: true, maxSelect: 1, values: COLOR_TOKENS },
        { name: 'sort_order', type: 'number', required: false, onlyInt: true, min: 0, max: 999 },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_annual_wheel_categories_tenant_key ON annual_wheel_categories (tenant, key)',
        'CREATE INDEX idx_annual_wheel_categories_tenant ON annual_wheel_categories (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${SUPERADMIN}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${SUPERADMIN}`
    });

    app.save(collection);

    // ── Seed defaults per tenant (best-effort, idempotent) ──────────────────
    // Utan seed skulle appen falla tillbaka på de inbyggda defaults (fail-soft),
    // men då kan de inte redigeras/raderas — så vi materialiserar dem här.
    try {
      const saved = app.findCollectionByNameOrId('annual_wheel_categories');
      const tenants = app.findRecordsByFilter('tenants', '', '-created', 0, 0);
      for (const t of tenants) {
        for (const def of SEED_CATEGORIES) {
          const existing = app.findRecordsByFilter(
            'annual_wheel_categories',
            `tenant = "${t.id}" && key = "${def.key}"`,
            '',
            1,
            0
          );
          if (existing.length > 0) continue;
          const rec = new Record(saved);
          rec.set('tenant', t.id);
          rec.set('key', def.key);
          rec.set('label', def.label);
          rec.set('token', def.token);
          rec.set('sort_order', def.sort_order);
          app.save(rec);
        }
      }
    } catch (e) {
      // Best-effort: schemat ska stå även om seedningen fallerar (t.ex. i en
      // testmiljö utan tenants). Appen faller tillbaka på defaults.
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('annual_wheel_categories'));
    } catch (e) {
      /* ignore */
    }
  }
);
