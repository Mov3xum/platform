/// <reference path="../pb_data/types.d.ts" />

// Lägger till disabled_modules (JSON array) på users så admin kan styra modulvisning per användare.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new Field({
        name: 'disabled_modules',
        type: 'json',
        required: false,
        maxSize: 2000
      })
    );

    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const field = users.fields.getByName('disabled_modules');
    if (field) users.fields.removeByName('disabled_modules');
    return app.save(users);
  }
);
