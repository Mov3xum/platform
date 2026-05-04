/// <reference path="../pb_data/types.d.ts" />

// Adds users.linked_startups now that the startups collection exists.
migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');

    users.schema.addField(
      new SchemaField({
        name: 'linked_startups',
        type: 'relation',
        required: false,
        options: {
          collectionId: 'startups_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 50
        }
      })
    );

    return dao.saveCollection(users);
  },
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');
    const field = users.schema.getFieldByName('linked_startups');
    if (field) users.schema.removeField(field.id);
    return dao.saveCollection(users);
  }
);
