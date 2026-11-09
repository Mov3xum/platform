/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46 — Bilagor till en stödcheckansökan: aktivitetsplan,
// offerter, kvitton (resecheck), slutrapport. Riktig PB-fil (samma mönster
// som `procurement_documents`, § 39.3), `protected` (kräver fil-token) och
// serveras BARA via den scopade proxyn /api/checkar/documents/[id]/file.
// Ingen textextraktion/AI här — bilagorna är underlag för mänsklig granskning.
//
// RLS: medlem-scopad via `startup` (bolaget ser sina egna bilagor),
// staff/observer hela tenanten. createRule roll-lös (§ 21.3) — uploads går
// via route-handlern som verifierar länkat bolag/staff och måste bära den
// inloggade som `uploaded_by`. update: BARA staff (en medlem byter aldrig
// fil/typ på en inskickad bilaga — ladda upp en ny i stället); delete staff
// eller uppladdaren. Ladda inte upp
// personuppgifter (UI varnar); kollektionen är denylistad för AI.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const MEMBER = '@request.auth.linked_startups:each ?= startup';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const applicationsCol = app.findCollectionByNameOrId('support_check_applications');

    const collection = new Collection({
      id: 'support_check_documents_collection',
      name: 'support_check_documents',
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
        { name: 'title', type: 'text', required: false, max: 200 },
        // MÅSTE spegla SUPPORT_CHECK_DOCUMENT_KINDS (lib/support-checks/documents).
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['attachment', 'final_report', 'receipt', 'signed_application', 'other']
        },
        {
          name: 'file',
          type: 'file',
          required: true,
          protected: true,
          maxSelect: 1,
          maxSize: 26214400, // 25 MB
          mimeTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'text/markdown',
            'image/png',
            'image/jpeg'
          ],
          thumbs: []
        },
        { name: 'filename', type: 'text', required: false, max: 300 },
        { name: 'mime', type: 'text', required: false, max: 150 },
        { name: 'size_bytes', type: 'number', required: false },
        { name: 'revision', type: 'number', required: false, onlyInt: true, min: 0 },
        {
          name: 'uploaded_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_support_check_documents_tenant ON support_check_documents (tenant)',
        'CREATE INDEX idx_support_check_documents_application ON support_check_documents (application)',
        'CREATE INDEX idx_support_check_documents_startup ON support_check_documents (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT} && @request.body.uploaded_by = @request.auth.id`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF} || @request.auth.id = uploaded_by)`
    });
    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('support_check_documents'));
    } catch (e) {
      /* ignore */
    }
  }
);
