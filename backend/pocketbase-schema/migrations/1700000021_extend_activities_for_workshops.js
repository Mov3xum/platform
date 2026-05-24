/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('activities');

    const kindField = collection.fields.getByName('kind');
    if (kindField?.values) {
      const values = new Set(kindField.values);
      values.add('manual');
      values.add('tool_run');
      values.add('workshop_assignment');
      values.add('workshop_run');
      kindField.values = Array.from(values);
    }

    if (!collection.fields.getByName('workshop')) {
      collection.fields.add(
        new Field({
          name: 'workshop',
          type: 'relation',
          required: false,
          collectionId: app.findCollectionByNameOrId('workshops').id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    if (!collection.fields.getByName('workshop_assignment')) {
      collection.fields.add(
        new Field({
          name: 'workshop_assignment',
          type: 'relation',
          required: false,
          collectionId: app.findCollectionByNameOrId('workshop_assignments').id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    if (!collection.fields.getByName('workshop_run')) {
      collection.fields.add(
        new Field({
          name: 'workshop_run',
          type: 'relation',
          required: false,
          collectionId: app.findCollectionByNameOrId('workshop_runs').id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    app.save(collection);

    const db = app.db();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_activities_workshop_assignment ON activities (workshop_assignment)'
    ).execute();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_activities_workshop_run ON activities (workshop_run)'
    ).execute();
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('activities');

    const kindField = collection.fields.getByName('kind');
    if (kindField?.values) {
      kindField.values = kindField.values.filter(
        (v) => v !== 'workshop_assignment' && v !== 'workshop_run'
      );
    }

    const workshopField = collection.fields.getByName('workshop');
    if (workshopField) collection.fields.remove(workshopField);
    const workshopAssignmentField = collection.fields.getByName('workshop_assignment');
    if (workshopAssignmentField) collection.fields.remove(workshopAssignmentField);
    const workshopRunField = collection.fields.getByName('workshop_run');
    if (workshopRunField) collection.fields.remove(workshopRunField);

    app.save(collection);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_activities_workshop_assignment').execute();
    db.newQuery('DROP INDEX IF EXISTS idx_activities_workshop_run').execute();
  }
);
