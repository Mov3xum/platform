/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.5 — Granskningskommentarer / kompletteringspunkter per
// avsnitt på en stödcheckansökan (samma mönster som `mission_comments`, § 29).
// `section` pekar ut vad kommentaren gäller (insatserna, kostnad, deltagare,
// bilagor …), `visible_to_applicant` avgör om bolaget ser den (intern
// coach→controller-dialog = false), `resolved_at` bockas av granskaren när
// punkten är åtgärdad. Ansökan kan inte gå vidare medan synliga olösta
// punkter finns — det enforce:as i skrivlagret.
//
// RLS: staff/observer ser allt; bolagsmedlem ser BARA synliga kommentarer på
// sitt bolags ansökningar. createRule roll-lös (§ 21.3) men författaren måste
// vara den inloggade (`@request.body.author = @request.auth.id`); update: författaren
// eller staff (lösa/redigera); delete admin/incubator_lead. Fritext
// personnummer-saneras på skrivvägen; auditeras bara som längd.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const MEMBER_VISIBLE = '(@request.auth.linked_startups:each ?= startup && visible_to_applicant = true)';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const applicationsCol = app.findCollectionByNameOrId('support_check_applications');

    const collection = new Collection({
      id: 'support_check_comments_collection',
      name: 'support_check_comments',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'application',
          type: 'relation',
          required: true,
          collectionId: applicationsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: startupsCol.id,
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
        // MÅSTE spegla SUPPORT_CHECK_SECTIONS i packages/shared/src/support-checks.ts.
        {
          name: 'section',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['general', 'activities', 'budget', 'participants', 'attachments', 'funding']
        },
        { name: 'body', type: 'text', required: true, min: 1, max: 4000 },
        { name: 'visible_to_applicant', type: 'bool', required: false },
        // Vilken revision kommentaren gavs på (så granskaren ser vad som ändrats sedan dess).
        { name: 'revision', type: 'number', required: false, onlyInt: true, min: 0 },
        { name: 'resolved_at', type: 'date', required: false },
        {
          name: 'resolved_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_support_check_comments_tenant ON support_check_comments (tenant)',
        'CREATE INDEX idx_support_check_comments_application ON support_check_comments (application)',
        'CREATE INDEX idx_support_check_comments_startup ON support_check_comments (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER_VISIBLE})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER_VISIBLE})`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT} && @request.body.author = @request.auth.id`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = author || ${STAFF})`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('support_check_comments'));
    } catch (e) {
      /* ignore */
    }
  }
);
