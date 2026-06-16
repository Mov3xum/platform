/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29 — "Dokumentation" på ett uppdrag (ersätter den tidigare
// artefakt-/länklistan). Movexum-staff laddar upp riktiga filer (PDF, Office,
// bild) kopplade till ett uppdrag; filerna lagras som RIKTIGA PocketBase-filer
// (samma mönster som education_documents § 18.3 / workshop_media § 18.2) och
// serveras via tokenlös publik URL.
//
// RLS: list/view = staff/observer-only (intern team-dokumentation). createRule
// refererar BARA auth-fält (ingen roll-check, ingen `= tenant`-join) per
// § 21.3 / migration 1700000111 — roll-/tenant-enforcement görs i
// upload-routen + server-actionen. Multi-värde-auth-fält matchas med `:each ?=`
// (PB v0.23.4-operatorbugg, § 21.3).
//
// PB v0.23 auto-lägger INTE created/updated vid `new Collection(...)`
// (§ 28.5) → vi lägger autodate-fälten explicit så sort '-created' fungerar.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const missionsCol = app.findCollectionByNameOrId('missions');

    const collection = new Collection({
      id: 'mission_documents_collection',
      name: 'mission_documents',
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
          name: 'mission',
          type: 'relation',
          required: true,
          collectionId: missionsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: false, max: 200 },
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 26214400, // 25 MB
          mimeTypes: [
            'application/pdf',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'text/markdown',
            'text/csv',
            'image/png',
            'image/jpeg',
            'image/webp'
          ],
          thumbs: []
        },
        { name: 'filename', type: 'text', required: false, max: 300 },
        { name: 'mime', type: 'text', required: false, max: 150 },
        { name: 'size_bytes', type: 'number', required: false },
        {
          name: 'uploaded_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_mission_documents_tenant ON mission_documents (tenant)',
        'CREATE INDEX idx_mission_documents_mission ON mission_documents (mission)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('mission_documents');
    return app.delete(collection);
  }
);
