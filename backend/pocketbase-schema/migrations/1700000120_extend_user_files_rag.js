/// <reference path="../pb_data/types.d.ts" />

// RAG-fält på det personliga filarkivet (/filer), CLAUDE.md § 27. Låter
// chatten köra mot filer som ÄGAREN själv laddat upp — texten extraheras,
// saneras (personnummer) och cachas i `extracted_text`, chunkas + embeddas till
// `user_file_chunks` (migration 1700000121) och blir sökbar via verktyget
// `search_my_files` (BARA i ägarens egen interaktiva chatt).
//
// GDPR: `user_files` är STRIKT ägaren-bara (oförändrade regler). `extracted_text`
// är ägarens eget filinnehåll, personnummer-sanerat, owner+tenant cascadeDelete
// → erasure tar bort det. `user_files` är fortsatt denylistad i
// lib/ai/redaction.ts; innehållet når modellen ENBART via det ägar-scopade
// `search_my_files` (aldrig query_collection, aldrig andra användare).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('user_files');

    const addField = (field) => {
      if (!collection.fields.getByName(field.name)) {
        collection.fields.add(new Field(field));
      }
    };

    addField({
      // Cachad, sanerad text — källa för chunkning + nyckelords-fallback.
      name: 'extracted_text',
      type: 'text',
      required: false,
      max: 320000
    });
    addField({
      // True när chunkning + embeddings (user_file_chunks) byggts.
      name: 'indexed',
      type: 'bool',
      required: false
    });
    addField({
      name: 'chunk_count',
      type: 'number',
      required: false,
      min: 0,
      onlyInt: true
    });

    app.save(collection);

    const db = app.db();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_uf_owner_indexed ON user_files (owner, indexed)'
    ).execute();
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('user_files');
    for (const name of ['extracted_text', 'indexed', 'chunk_count']) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field);
    }
    app.save(collection);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_uf_owner_indexed').execute();
  }
);
