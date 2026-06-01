/// <reference path="../pb_data/types.d.ts" />

// AI-kategorisering av det personliga filarkivet (/filer), CLAUDE.md § 24.
// En AI-agent (Mistral, EU) klassar varje fil till ETT fast Movexum-ämne och
// föreslår en valfri bolagskoppling. När agenten är osäker flaggas filen
// `needs_review` och användaren bekräftar via en dialog (människa-i-loopen,
// EU AI Act art. 14). Inga nya datavägar för agenter — `user_files` är
// fortsatt denylistad i lib/ai/schema.ts och fälten är owner-only via de
// befintliga collection-reglerna (oförändrade här).
//
// GDPR § 5: `topic`/`topic_status` är icke-PII metadata; `topic_confidence`
// är AI:ns självskattning (transparens, art. 13). `startup` är en relation
// till ett bolag i samma tenant (ingen PII för aktiebolag). Det extraherade
// textutdrag som matas till AI:n lagras ALDRIG — bara klassningsresultatet.

const FILE_TOPICS = [
  'affarsplan_strategi',
  'finansiering_kapital',
  'hallbarhet_esg',
  'internationalisering',
  'pitch_material',
  'juridik_avtal',
  'rapporter_uppfoljning',
  'osorterat'
];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('user_files');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const addField = (field) => {
      if (!collection.fields.getByName(field.name)) {
        collection.fields.add(new Field(field));
      }
    };

    addField({
      name: 'topic',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: FILE_TOPICS
    });
    addField({
      name: 'topic_status',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: ['pending', 'auto', 'needs_review', 'confirmed']
    });
    addField({
      name: 'topic_confidence',
      type: 'number',
      required: false,
      min: 0,
      max: 1
    });
    // Valfri bolagskoppling. Ingen cascade — filen överlever om bolaget tas
    // bort (samma princip som chat_thread/tool_run på user_files).
    addField({
      name: 'startup',
      type: 'relation',
      required: false,
      collectionId: startupsCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    addField({
      name: 'categorized_at',
      type: 'date',
      required: false
    });

    app.save(collection);

    const db = app.db();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_uf_owner_topic ON user_files (owner, topic)'
    ).execute();
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('user_files');
    for (const name of [
      'topic',
      'topic_status',
      'topic_confidence',
      'startup',
      'categorized_at'
    ]) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field);
    }
    app.save(collection);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_uf_owner_topic').execute();
  }
);
