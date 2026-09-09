/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 37 — Hemmaplan (organisationens startsida). Anslagstavlan:
// nyheter, info, instruktioner och firanden som staff skriver till
// organisationen. Ren verksamhetsinformation (ingen PII utöver författar-
// relationen, som är en intern användare).
//
// Målgrupp: `staff` (default — Movexum-personal + observer) eller `all`
// (även bolagsmedlemmar; visas på "Min översikt"). list/view enforce:ar det
// med `:each ?=` (§ 21.3 — aldrig bart `?=` mot multi-värde-fält).
//
// createRule refererar BARA auth-fält (ingen roll-check, ingen `= tenant`-
// join — PB v0.23.4-buggen, § 21.3/migration 1700000111); rollen enforce:as i
// server-actionen. update/delete: författaren själv ELLER admin/incubator_lead.
//
// PB v0.23 auto-lägger INTE created/updated vid `new Collection(...)` (§ 28.5)
// → autodate-fälten läggs explicit så sort '-created' fungerar.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const MODERATOR =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const AUTHOR_MATCH = '@request.auth.id = author';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'org_posts_col',
      name: 'org_posts',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Ingen cascade — raderas författaren lever inlägget vidare (anonymt).
        {
          name: 'author',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: true, min: 1, max: 160 },
        // Markdown — renderas alltid via lib/safe-html (aldrig rå HTML).
        { name: 'body', type: 'text', required: false, max: 20000 },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          // MÅSTE spegla ORG_POST_KINDS i packages/shared/src/org-posts.ts.
          values: ['news', 'notice', 'instruction', 'celebration']
        },
        {
          name: 'audience',
          type: 'select',
          required: true,
          maxSelect: 1,
          // MÅSTE spegla ORG_POST_AUDIENCES i packages/shared/src/org-posts.ts.
          values: ['staff', 'all']
        },
        { name: 'pinned', type: 'bool', required: false },
        // Tomt = publicerad direkt. Framtida datum = schemalagd.
        { name: 'published_at', type: 'date', required: false },
        // Tomt = utgår aldrig.
        { name: 'expires_at', type: 'date', required: false },
        // Intern sökväg (/…) eller https-URL — valideras i server-actionen.
        { name: 'link_url', type: 'text', required: false, max: 500 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_org_posts_tenant ON org_posts (tenant)',
        'CREATE INDEX idx_org_posts_tenant_pinned ON org_posts (tenant, pinned)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || audience = "all")`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || audience = "all")`,
      createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${AUTHOR_MATCH} || ${MODERATOR})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${AUTHOR_MATCH} || ${MODERATOR})`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('org_posts'));
    } catch (e) {
      /* ignore */
    }
  }
);
