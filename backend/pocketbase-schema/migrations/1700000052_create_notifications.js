/// <reference path="../pb_data/types.d.ts" />

// Ny collection `notifications` — in-app-notiser för samarbete.
// Triggas av server actions vid kommentar, mention, tilldelad,
// status-ändring och stage-advance. Användare ser bara sina egna.

const ANY_AUTH = '@request.auth.id != ""';
const IS_RECIPIENT = '@request.auth.id = user';
const IS_ACTOR = '@request.auth.id = actor';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'notifications_collection',
      name: 'notifications',
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
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['comment', 'mention', 'assigned', 'status_change', 'stage_advance', 'due_soon']
        },
        {
          name: 'mission',
          type: 'relation',
          required: false,
          collectionId: 'missions_collection',
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'actor',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'comment',
          type: 'relation',
          required: false,
          collectionId: 'mission_comments_collection',
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'payload_json', type: 'json', required: false, maxSize: 8000 },
        { name: 'read_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_notifications_user_read ON notifications (user, read_at, created)',
        'CREATE INDEX idx_notifications_tenant_user ON notifications (tenant, user)'
      ],
      // Användare kan ENDAST se sina egna notiser.
      listRule: `${ANY_AUTH} && ${IS_RECIPIENT}`,
      viewRule: `${ANY_AUTH} && ${IS_RECIPIENT}`,
      // Skapas av server actions med inloggad user som actor (eller utan
      // actor för systemnotiser). Vi tillåter create när actor matchar
      // request.auth.id ELLER när actor är tom (system-create — server-side
      // skickar inte system-notiser från klienten ändå, men regeln håller).
      createRule: `${ANY_AUTH} && (actor = "" || ${IS_ACTOR})`,
      // Endast mottagaren kan markera notiser som lästa.
      updateRule: `${ANY_AUTH} && ${IS_RECIPIENT}`,
      deleteRule: `${ANY_AUTH} && ${IS_RECIPIENT}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('notifications');
    return app.delete(collection);
  }
);
