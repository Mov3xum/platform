/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 9.6 / § 28 — AI-förbrukningen ska skala och vara komplett.
//
// 1) `ai_usage_monthly` — en rad per (tenant, kalendermånad UTC) med
//    summerad kostnad, tokens och antal anrop. Bakgrund: månadstaket
//    (`assertWithinAiBudget`, körs vid VARJE agent-loop) och AI-analysens
//    vyer summerade upp till 10 000 `ai_usage_events`-rader per tenant och
//    minut. Nu läses EN rad. Raden hålls aktuell ATOMISKT av PB-hooken
//    `hooks/ai_usage_rollup.pb.js` (SQL-upsert `ON CONFLICT(tenant, month)`
//    efter varje skapad event) och backfillas här ur befintliga events.
//    Talfälten är VALFRIA — PB tolkar 0 som "tomt" för ett required
//    nummerfält (§ 9.6, migration 1700000145).
//    RLS: list/view = staff/observer i samma tenant (`:each ?=`, § 21.3);
//    create/update/delete = null (endast superuser/hooken). Ingen PII —
//    bara tekniska aggregat; läsbar även för chattens query_collection.
//
// 2) `ai_usage_events.user` blir VALFRITT. Publika flöden (publik
//    kompass-chatt, AI-sammanställning av formulär/quiz) saknar inloggad
//    användare och loggades därför aldrig — förbrukningen syntes varken i
//    AI-analysen eller i månadstaket. createRule (`@request.auth.id = user`)
//    är oförändrad: en vanlig användare kan fortfarande bara logga i eget
//    namn; anonyma rader skrivs enbart via superuser.
//
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32). Speglas i
// scripts/setup-via-api.mjs (collection-def + patch av user) och asserteras i
// scripts/verify-baseline.mjs. Idempotent: kollektionen skapas bara om den
// saknas (setup-via-api kan ha hunnit före) och backfillen SÄTTER absoluta
// summor, så en omkörning dubbelräknar aldrig. Efter backfillen beror
// rollupen INTE på rådatan: gallring av gamla `ai_usage_events` (retention)
// lämnar månadssummorna orörda.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function newId() {
  try {
    return $security.randomStringWithAlphabet(15, ID_ALPHABET);
  } catch (e) {
    return String($security.randomString(15)).toLowerCase();
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    // ── 1. Kollektionen (bara om den saknas) ─────────────────────────────
    let exists = false;
    try {
      app.findCollectionByNameOrId('ai_usage_monthly');
      exists = true;
    } catch (e) {
      exists = false;
    }

    if (!exists) {
      const collection = new Collection({
        id: 'ai_usage_monthly_collection',
        name: 'ai_usage_monthly',
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
          // 'YYYY-MM' (UTC) — samma månadsgräns som monthStartIso() i budget.ts.
          { name: 'month', type: 'text', required: true, min: 7, max: 7, pattern: '^\\d{4}-\\d{2}$' },
          { name: 'cost_usd', type: 'number', required: false, min: 0 },
          { name: 'tokens_in', type: 'number', required: false, min: 0 },
          { name: 'tokens_out', type: 'number', required: false, min: 0 },
          { name: 'events', type: 'number', required: false, min: 0 }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_ai_usage_monthly_tenant_month ON ai_usage_monthly (tenant, month)',
          'CREATE INDEX idx_ai_usage_monthly_month ON ai_usage_monthly (month)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        // Endast superuser/hooken skriver — aggregatet får aldrig kunna
        // manipuleras via API:t (månadstaket läser det).
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(collection);
    }

    // ── 2. ai_usage_events.user → valfritt (anonyma publika flöden) ──────
    let eventsCol = null;
    try {
      eventsCol = app.findCollectionByNameOrId('ai_usage_events');
    } catch (e) {
      eventsCol = null;
    }
    if (!eventsCol) return;

    const userField = eventsCol.fields.getByName('user');
    if (userField && userField.required) {
      userField.required = false;
      userField.minSelect = 0;
      app.save(eventsCol);
    }

    // ── 3. Backfill ur befintliga events ────────────────────────────────
    // Saknas `created` (instans utan migration 1700000128) går raderna inte
    // att placera i en månad — då hoppar vi över backfillen. Appen faller
    // tillbaka på summering när rollup-raden saknas (fail-open, § 9.6).
    if (!eventsCol.fields.getByName('created')) {
      console.log('[1700000185] ai_usage_events saknar created — hoppar över backfill');
      return;
    }

    const rows = arrayOf(
      new DynamicModel({ tenant: '', month: '', cost: -0, tin: -0, tout: -0, n: -0 })
    );
    app
      .db()
      .newQuery(
        "SELECT tenant AS tenant, substr(created, 1, 7) AS month, " +
          'COALESCE(SUM(cost_estimate_usd), 0) AS cost, ' +
          'COALESCE(SUM(tokens_in), 0) AS tin, ' +
          'COALESCE(SUM(tokens_out), 0) AS tout, ' +
          'COUNT(*) AS n ' +
          'FROM ai_usage_events ' +
          "WHERE tenant != '' AND created IS NOT NULL AND created != '' " +
          'AND tenant IN (SELECT id FROM tenants) ' +
          'GROUP BY tenant, substr(created, 1, 7)'
      )
      .all(rows);

    const now = new Date().toISOString().replace('T', ' ');
    let written = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const month = String(r.month || '');
      if (!r.tenant || !MONTH_RE.test(month)) {
        skipped += 1;
        continue;
      }
      app
        .db()
        .newQuery(
          'INSERT INTO ai_usage_monthly (id, tenant, month, cost_usd, tokens_in, tokens_out, events, created, updated) ' +
            'VALUES ({:id}, {:tenant}, {:month}, {:cost}, {:tin}, {:tout}, {:n}, {:now}, {:now}) ' +
            'ON CONFLICT(tenant, month) DO UPDATE SET ' +
            'cost_usd = excluded.cost_usd, tokens_in = excluded.tokens_in, ' +
            'tokens_out = excluded.tokens_out, events = excluded.events, updated = excluded.updated'
        )
        .bind({
          id: newId(),
          tenant: String(r.tenant),
          month: month,
          cost: num(r.cost),
          tin: Math.round(num(r.tin)),
          tout: Math.round(num(r.tout)),
          n: Math.round(num(r.n)),
          now: now
        })
        .execute();
      written += 1;
    }
    console.log('[1700000185] ai_usage_monthly backfill:', written, 'rader', skipped ? `(${skipped} hoppade)` : '');
  },
  (app) => {
    try {
      const eventsCol = app.findCollectionByNameOrId('ai_usage_events');
      const userField = eventsCol.fields.getByName('user');
      if (userField && !userField.required) {
        userField.required = true;
        userField.minSelect = 1;
        app.save(eventsCol);
      }
    } catch (e) {
      /* ignore — rader utan user gör att required inte kan återställas */
    }
    try {
      app.delete(app.findCollectionByNameOrId('ai_usage_monthly'));
    } catch (e) {
      /* ignore */
    }
  }
);
