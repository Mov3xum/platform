/// <reference path="../pb_data/types.d.ts" />

// Extends the built-in `users` auth collection with tenant + roles + display_name.
// linked_startups added in a later migration once `startups` exists.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new Field({
        name: 'tenant',
        type: 'relation',
        required: true,
        collectionId: 'tenants_collection',
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1
      })
    );

    users.fields.add(
      new Field({
        name: 'roles',
        type: 'select',
        required: true,
        maxSelect: 7,
        values: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'partner',
          'startup_member',
          'observer'
        ]
      })
    );

    users.fields.add(
      new Field({
        name: 'display_name',
        type: 'text',
        required: false,
        max: 200
      })
    );

    users.listRule = '@request.auth.id != "" && @request.auth.tenant = tenant';
    users.viewRule = '@request.auth.id != "" && @request.auth.tenant = tenant';
    users.updateRule = '@request.auth.id = id';
    users.createRule = null;
    users.deleteRule = null;

    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    ['tenant', 'roles', 'display_name'].forEach((name) => {
      const field = users.fields.getByName ? users.fields.getByName(name) : null;
      if (field) users.fields.removeByName(name);
    });

    return app.save(users);
  }
);
