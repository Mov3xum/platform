/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new Field({
        name: 'linked_startups',
        type: 'relation',
        required: false,
        collectionId: 'startups_collection',
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 50
      })
    );

    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('linked_startups');
    return app.save(users);
  }
);
