/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX: gör om `?=`→`:each ?=`-svepet från 1700000108 — pekarsäkert denna gång.
// =============================================================================
//
// BAKGRUND: 1700000108_fix_all_rule_operators_each.js skulle rätta ALLA regler
// som använder den trasiga `?=`-operatorn mot multi-värde-auth-fält
// (PB v0.23.4-buggen, CLAUDE.md § 21.3). Men i PB v0.23:s JSVM exponeras
// collection-regler som Go `*string`-POINTERS — `typeof collection.listRule`
// är 'object', INTE 'string'. Svepets guard `typeof rule !== 'string'`
// returnerade därför varje regel orörd → migrationen var en TYST NO-OP.
//
// Konsekvens (empiriskt verifierad mot pocketbase 0.23.4 med repots
// migrationskedja): workshop_assignments/workshop_runs/strategies/
// strategy_revisions m.fl. har kvar bara `?=` i list/view/update (+ en rad
// deleteRules) → list ger 400, view ger 404 — för ALLA användartokens, även
// admin. Workshop-tilldelningar blev osynliga/oöppningsbara överallt där
// läsningen inte går via superuser (t.ex. /education/assignments/[id],
// /startups/[id]/verktyg, /education).
//
// Den här migrationen kör samma tre transformationsmönster, men koercerar
// regelvärdet till sträng via String(...) först. null (superuser-only) och
// tomma regler (publika) lämnas orörda. createRule rörs ALDRIG (§ 21.3).
// Idempotent: en redan fixad `...:each ?=` matchar inte mönstren.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration — 1700000108 redigeras
// inte. down() är en no-op (att återinföra `?=` återskapar bara buggen).
// `scripts/verify-baseline.mjs` asserterar numera att inga bara `?=` mot
// multi-värde-auth-fält finns kvar i live-reglerna, så en framtida no-op-
// regression fälls innan deploy.
// =============================================================================

function fixRule(rule) {
  if (rule === null || rule === undefined) return null; // superuser-only — rör ej
  const s = String(rule);
  if (s === '' || s === 'null' || s === 'undefined') return null;
  let out = s;
  // c) reordera multi-relation-jämförelsen (kör först).
  out = out.replace(
    /@request\.auth\.id\s*\?=\s*recipients/g,
    'recipients:each ?= @request.auth.id'
  );
  // a) + b) lägg `:each` på multi-värde-auth-fält med bart `?=`.
  out = out.replace(/@request\.auth\.roles\s*\?=/g, '@request.auth.roles:each ?=');
  out = out.replace(
    /@request\.auth\.linked_startups\s*\?=/g,
    '@request.auth.linked_startups:each ?='
  );
  return out === s ? null : out;
}

function getAllCollections(app) {
  if (typeof app.findAllCollections === 'function') {
    try {
      const all = app.findAllCollections();
      if (all && all.length) return all;
    } catch (_e) {
      /* fall through */
    }
  }
  return [];
}

migrate(
  (app) => {
    const collections = getAllCollections(app);
    for (const collection of collections) {
      let changed = false;
      // OBS: createRule medvetet utelämnad (§ 21.3).
      for (const key of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
        const fixed = fixRule(collection[key]);
        if (fixed !== null) {
          collection[key] = fixed;
          changed = true;
        }
      }
      if (changed) {
        app.save(collection);
      }
    }
  },
  (_app) => {
    // No-op: att återinföra `?=` skulle bara återskapa buggen.
  }
);
