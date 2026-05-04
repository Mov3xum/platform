/// <reference path="../pb_data/types.d.ts" />

// Extends the built-in `users` auth collection with tenant + roles + linked_startups.
migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');

    users.schema.addField(
      new SchemaField({
        name: 'tenant',
        type: 'relation',
        required: true,
        options: {
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        }
      })
    );

    users.schema.addField(
      new SchemaField({
        name: 'roles',
        type: 'select',
        required: true,
        options: {
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
        }
      })
    );

    users.schema.addField(
      new SchemaField({
        name: 'display_name',
        type: 'text',
        required: false,
        options: { max: 200 }
      })
    );

    // linked_startups added in a later migration once `startups` exists.

    // Users can read others within the same tenant.
    users.listRule =
      '@request.auth.id != "" && @request.auth.tenant = tenant';
    users.viewRule =
      '@request.auth.id != "" && @request.auth.tenant = tenant';
    // Self-update only; admins/incubator_lead handled via admin UI.
    users.updateRule = '@request.auth.id = id';
    users.createRule = null;
    users.deleteRule = null;

    return dao.saveCollection(users);
  },
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');

    ['tenant', 'roles', 'display_name'].forEach((name) => {
      const field = users.schema.getFieldByName(name);
      if (field) users.schema.removeField(field.id);
    });

    return dao.saveCollection(users);
  }
);
