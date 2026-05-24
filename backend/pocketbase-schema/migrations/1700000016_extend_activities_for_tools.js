/// <reference path="../pb_data/types.d.ts" />

// Extends the activities collection with kind, tool, and tool_run fields.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('activities');

    // Add kind field
    collection.fields.add(
      new Field({
        name: 'kind',
        type: 'select',
        required: false,
        maxSelect: 1,
        values: ['manual', 'tool_run']
      })
    );

    // Add tool relation field
    collection.fields.add(
      new Field({
        name: 'tool',
        type: 'relation',
        required: false,
        collectionId: app.findCollectionByNameOrId('tools').id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      })
    );

    // Add tool_run relation field
    collection.fields.add(
      new Field({
        name: 'tool_run',
        type: 'relation',
        required: false,
        collectionId: app.findCollectionByNameOrId('tool_runs').id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      })
    );

    app.save(collection);

    // Backfill: set kind='manual' for all existing activities
    const db = app.db();
    db.newQuery("UPDATE activities SET kind='manual' WHERE kind = '' OR kind IS NULL").execute();

    // Add index on kind
    db.newQuery('CREATE INDEX IF NOT EXISTS idx_activities_kind ON activities (kind)').execute();
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('activities');

    // Remove the added fields
    const kindField = collection.fields.getByName('kind');
    if (kindField) collection.fields.remove(kindField);
    const toolField = collection.fields.getByName('tool');
    if (toolField) collection.fields.remove(toolField);
    const toolRunField = collection.fields.getByName('tool_run');
    if (toolRunField) collection.fields.remove(toolRunField);

    app.save(collection);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_activities_kind').execute();
  }
);
