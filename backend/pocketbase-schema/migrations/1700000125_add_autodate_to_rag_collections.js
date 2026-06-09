/// <reference path="../pb_data/types.d.ts" />

// Lägger till `created`/`updated`-autodate-fält på RAG-kollektionerna
// (CLAUDE.md § 26–27). I PocketBase v0.23 är created/updated VANLIGA
// autodate-fält som måste deklareras explicit — `new Collection(...)` i en
// JSVM-migration auto-lägger dem INTE. Migrationerna 1700000118/1700000119/
// 1700000121 (och bootstrap-skriptets motsvarigheter) skapade kollektionerna
// utan dem, vilket gav två tysta fel i kunskapsbasen:
//
//   1. `listOrgKnowledgeAction` sorterar på `-created` → PB svarar 400 →
//      catch → tom lista. Uppladdningar LYCKADES men syntes aldrig på
//      /kunskapsbas ("Inget material än"), så funktionen upplevdes trasig.
//   2. Nyckelords-fallbacken i RAG-sökningen (`keywordSearch` i lib/ai/rag.ts)
//      sorterar källfiler på `-updated` → 400 → fail-soft tom retur → chatten
//      hittade inget när embeddings saknades.
//
// Idempotent (hoppar fält som redan finns). `user_files` täcks redan av
// bootstrap-skriptets autodate-backfill men inkluderas här för paritet på
// instanser som enbart kör migrationer. Befintliga rader får tomma värden
// tills nästa write — sortering fungerar ändå (NULL sorterar konsekvent).
//
// Ingen ny datakategori, ingen PII-väg, inga regeländringar (§ 10.3 A.8.32 —
// nytt oföränderligt filnummer).

const COLLECTIONS = [
  'org_knowledge',
  'org_knowledge_chunks',
  'user_files',
  'user_file_chunks'
];

migrate(
  (app) => {
    for (const name of COLLECTIONS) {
      let collection;
      try {
        collection = app.findCollectionByNameOrId(name);
      } catch (_) {
        continue; // kollektionen saknas i denna instans — hoppa
      }

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
  },
  (app) => {
    // Ingen down-migration: fälten kan ha lagts av annan väg (bootstrap-
    // backfill) och att ta bort created/updated raderar tidsstämpel-data.
  }
);
