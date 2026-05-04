/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'startup_team_members_collection',
      name: 'startup_team_members',
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
          name: 'user',
          type: 'relation',
          required: false,
          options: {
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          }
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 }
        },
        {
          name: 'role_title',
          type: 'text',
          required: false,
          options: { max: 200 }
        },
        {
          name: 'email',
          type: 'email',
          required: false
        },
        {
          name: 'is_founder',
          type: 'bool',
          required: false
        },
        {
          name: 'equity_pct',
          type: 'number',
          required: false,
          options: { min: 0, max: 100 }
        }
      ],
      indexes: ['CREATE INDEX idx_team_members_startup ON startup_team_members (startup)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('startup_team_members');
    return dao.deleteCollection(collection);
  }
);
