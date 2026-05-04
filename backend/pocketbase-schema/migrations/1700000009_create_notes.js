/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
// Notes are visible to staff + the author. Confidential notes only to staff.
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'notes_collection',
      name: 'notes',
      type: 'base',
      schema: [
        {
          name: 'startup',
          type: 'relation',
          required: true,
          options: {
            collectionId: 'startups_collection',
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          }
        },
        {
          name: 'author',
          type: 'relation',
          required: true,
          options: {
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            minSelect: 1,
            maxSelect: 1
          }
        },
        {
          name: 'body',
          type: 'editor',
          required: true
        },
        {
          name: 'confidential',
          type: 'bool',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_notes_startup ON notes (startup)',
        'CREATE INDEX idx_notes_author ON notes (author)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (confidential = false || ${STAFF_ROLES} || @request.auth.id = author)`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (confidential = false || ${STAFF_ROLES} || @request.auth.id = author)`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.id = author`,
      updateRule: `${ANY_AUTH} && @request.auth.id = author`,
      deleteRule: `${ANY_AUTH} && (@request.auth.id = author || @request.auth.roles ?= "admin")`
    });

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('notes');
    return dao.deleteCollection(collection);
  }
);
