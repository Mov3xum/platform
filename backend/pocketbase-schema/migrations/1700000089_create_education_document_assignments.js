/// <reference path="../pb_data/types.d.ts" />

// Tilldelning av ett utbildningsdokument (education_documents, migration
// 1700000088) till ett bolag, med valfria instruktioner och deadline. Bolaget
// kan markera tilldelningen som "slutförd" (status completed) — då visas en
// stor bock på bolagskortet och en rad loggas i aktivitetsfeeden
// ("<bolag> slutförde <dokument>").
//
// create/update/delete är staff-only på rule-nivå; bolagsmedlemmens
// "slutför"-skrivning går via server action med superuser-fallback (samma
// mönster som workshop-progressen, CLAUDE.md § 9.5 / PB v0.23 rule-eval-bugg).
// Behörigheten (staff ELLER länkad startup_member) verifieras i server-actionen.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'education_document_assignments_collection',
      name: 'education_document_assignments',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'document',
          type: 'relation',
          required: true,
          collectionId: 'education_documents_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: 'startups_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'instructions',
          type: 'text',
          required: false,
          max: 2000
        },
        {
          name: 'due_date',
          type: 'date',
          required: false
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['assigned', 'completed']
        },
        {
          name: 'assigned_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'completed_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'completed_at',
          type: 'date',
          required: false
        },
        {
          name: 'activity',
          type: 'relation',
          required: false,
          collectionId: 'activities_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_edu_doc_assign_unique ON education_document_assignments (tenant, document, startup)',
        'CREATE INDEX idx_edu_doc_assign_startup ON education_document_assignments (startup)',
        'CREATE INDEX idx_edu_doc_assign_document ON education_document_assignments (document)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('education_document_assignments');
    return app.delete(collection);
  }
);
