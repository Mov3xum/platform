/// <reference path="../pb_data/types.d.ts" />

// Ny collection `mission_comments` — generisk kommentarstråd på missions
// för samarbete mellan roller. Stödjer trådade svar via `parent`,
// @mentions via inline-markup i `body` + denormaliserad `mentions[]`-rel.
//
// RBAC i app-lagret (jfr 1700000049_drop_role_checks). Backend-rules
// kollar bara att author = inloggad user och tenant matchar.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const IS_AUTHOR = '@request.auth.id = author';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'mission_comments_collection',
      name: 'mission_comments',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'mission',
          type: 'relation',
          required: true,
          collectionId: 'missions_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'author',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'body', type: 'text', required: true, min: 1, max: 4000 },
        {
          name: 'mentions',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 25
        },
        {
          name: 'parent',
          type: 'relation',
          required: false,
          collectionId: 'mission_comments_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'edited_at', type: 'date', required: false },
        { name: 'deleted', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_mission_comments_mission ON mission_comments (mission, created)',
        'CREATE INDEX idx_mission_comments_tenant_author ON mission_comments (tenant, author)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${IS_AUTHOR}`,
      updateRule: `${ANY_AUTH} && ${IS_AUTHOR}`,
      deleteRule: `${ANY_AUTH} && ${IS_AUTHOR}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('mission_comments');
    return app.delete(collection);
  }
);
