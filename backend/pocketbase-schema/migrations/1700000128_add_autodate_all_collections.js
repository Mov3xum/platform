/// <reference path="../pb_data/types.d.ts" />

// Lägger till `created`/`updated`-autodate-fält på ALLA bas-kollektioner som
// saknar dem (CLAUDE.md § 23.6 / § 26.4 — PB v0.23 auto-lägger dem INTE vid
// `new Collection(...)` i JSVM-migrationer). Tidigare fixar var riktade
// (1700000125 RAG, 1700000126 compass); detta är det generella svepet.
//
// Användarsynligt fel som föranledde svepet: /insights (och /admin/ai-miljo
// samt månadsbudget-spärren) filtrerar `created >= <period>` på `tool_runs`
// och `ai_usage_events` — bägge skapade UTAN autodate-fält (1700000015 resp.
// 1700000058, vars index t.o.m. refererar `created`). PB svarar då HTTP 400
// ("Something went wrong while processing your request") på varje fråga med
// created-filter/-sortering → hela statistiksidan felade och budget-spärren
// blev tyst inaktiv (fail-open i budget.server.ts).
//
// Värde-backfill (samma idiom som 1700000127_backfill_compass_lead_timestamps):
//   - tool_runs.created ← started_at → completed_at → migrations-tidpunkt
//     (+ rowid-sekunder för stabil inbördes ordning).
//   - ai_usage_events.created ← migrations-tidpunkt (+ rowid-stagger) — raden
//     har ingen annan tidsstämpel; hellre synlig i innevarande period EN gång
//     än osynlig i statistiken för alltid.
//   Övriga svepta kollektioner får tomma värden tills nästa write (sortering
//   fungerar ändå; NULL sorterar konsekvent).
//
// Idempotent (hoppar fält som redan finns; backfill rör bara tomma värden).
// Ingen ny datakategori, ingen PII-väg, inga regeländringar (§ 10.3 A.8.32 —
// nytt oföränderligt filnummer). Speglas i setup-via-api.mjs (generiskt
// autodate-svep) för bootstrap-paritet.

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
    // 1) Svep: lägg till saknade autodate-fält. Bara bas-kollektioner —
    // vyer kan inte få autodate och auth-/systemkollektioner lämnas orörda.
    // OBS § 21.3-pekarfällan: koercera med String(...), aldrig typeof-guards.
    for (const collection of getAllCollections(app)) {
      const name = String(collection.name || '');
      if (!name || name.startsWith('_')) continue;
      if (collection.system) continue;
      if (String(collection.type) !== 'base') continue;

      let changed = false;
      if (!collection.fields.getByName('created')) {
        collection.fields.add(
          new Field({ name: 'created', type: 'autodate', onCreate: true, onUpdate: false })
        );
        changed = true;
      }
      if (!collection.fields.getByName('updated')) {
        collection.fields.add(
          new Field({ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true })
        );
        changed = true;
      }
      if (changed) app.save(collection);
    }

    // 2) Värde-backfill för statistik-kritiska rader (tomma värden = raden
    // syns aldrig i period-KPI:er). Fail-soft per kollektion — en instans
    // utan kollektionen hoppar bara över.
    try {
      app.findCollectionByNameOrId('tool_runs');
      app
        .db()
        .newQuery(
          "UPDATE tool_runs SET created = COALESCE(NULLIF(started_at, ''), NULLIF(completed_at, ''), strftime('%Y-%m-%d %H:%M:%f', 'now', '+' || (rowid % 600) || ' seconds') || 'Z') WHERE created IS NULL OR created = ''"
        )
        .execute();
      app
        .db()
        .newQuery(
          "UPDATE tool_runs SET updated = created WHERE (updated IS NULL OR updated = '') AND created IS NOT NULL AND created != ''"
        )
        .execute();
    } catch (_) {
      /* instans utan tool_runs — hoppa */
    }

    try {
      app.findCollectionByNameOrId('ai_usage_events');
      app
        .db()
        .newQuery(
          "UPDATE ai_usage_events SET created = strftime('%Y-%m-%d %H:%M:%f', 'now', '+' || (rowid % 600) || ' seconds') || 'Z' WHERE created IS NULL OR created = ''"
        )
        .execute();
      app
        .db()
        .newQuery(
          "UPDATE ai_usage_events SET updated = created WHERE (updated IS NULL OR updated = '') AND created IS NOT NULL AND created != ''"
        )
        .execute();
    } catch (_) {
      /* instans utan ai_usage_events — hoppa */
    }
  },
  (_app) => {
    // Ingen down-migration: fälten kan ha lagts av annan väg (bootstrap-
    // backfill) och att ta bort created/updated raderar tidsstämpel-data.
  }
);
