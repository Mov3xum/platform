/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ONLY =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'incubator_reports_collection',
      name: 'incubator_reports',
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
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        {
          name: 'recipient',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['vinnova', 'tillvaxtverket', 'region', 'kommun', 'other']
        },
        { name: 'recipient_label', type: 'text', required: false, max: 200 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft_ai', 'review', 'sent', 'archived']
        },
        { name: 'period_label', type: 'text', required: false, max: 100 },
        { name: 'period_start', type: 'date', required: false },
        { name: 'period_end', type: 'date', required: false },
        { name: 'due_date', type: 'date', required: false },
        { name: 'completion', type: 'number', required: false, min: 0, max: 100 },
        { name: 'sections_json', type: 'json', required: false, maxSize: 1000000 },
        { name: 'preview_md', type: 'editor', required: false },
        { name: 'accent', type: 'text', required: false, max: 50 },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: ['CREATE INDEX idx_reports_tenant ON incubator_reports (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ONLY}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('incubator_reports');
    return app.delete(collection);
  }
);
