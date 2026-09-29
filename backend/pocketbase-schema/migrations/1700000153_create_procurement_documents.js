/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39.3 — Uppladdat upphandlingsunderlag (förfrågningsunderlag,
// avtal, avropsbeskrivningar). Filen lagras som RIKTIG PocketBase-fil (samma
// mönster som mission_documents § 29 / education_documents § 18.3), texten
// extraheras EN gång vid uppladdning, personnummer-saneras (§ 15.6) och
// cachas i `extracted_text`; AI-utkastet (`ProcurementDraft`) som lästs ut
// ur texten sparas i `analysis` så det kan visas/återanvändas utan nytt
// modellanrop. Filen är `protected` (tokenkrav) och serveras via en
// tenant-scopad proxy; kollektionen är denylistad för query_collection
// (fritext ur tredjepartsdokument, § 9.3). `procurement` är valfri: underlaget laddas upp FÖRE
// upphandlingen skapas och kopplas när utkastet sparas (cascadeDelete).
//
// RLS: list/view = staff/observer-only (intern avtalsdata). createRule
// refererar BARA auth-fält (§ 21.3) — roll enforce:as i upload-routen.
// PII: filer ska inte innehålla personuppgifter (UI varnar); ändå saneras
// personnummer på extraktionsvägen. Autodate explicit (§ 28.5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const procurementsCol = app.findCollectionByNameOrId('procurements');

    const collection = new Collection({
      id: 'procurement_documents_collection',
      name: 'procurement_documents',
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
          name: 'procurement',
          type: 'relation',
          required: false,
          collectionId: procurementsCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: false, max: 200 },
        {
          name: 'file',
          type: 'file',
          required: true,
          // Avtals-/prisunderlag är intern data → skyddad fil, serveras via
          // den tenant-scopade proxyn /api/procurements/documents/[id]/file
          // (samma mönster som avtals-PDF:er, § 19).
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
            'text/markdown'
          ],
          thumbs: []
        },
        { name: 'filename', type: 'text', required: false, max: 300 },
        { name: 'mime', type: 'text', required: false, max: 150 },
        { name: 'size_bytes', type: 'number', required: false },
        // Sanerad, cappad text (~200 KB) — underlaget för AI-utkastet.
        { name: 'extracted_text', type: 'text', required: false, max: 250000 },
        { name: 'char_count', type: 'number', required: false, min: 0 },
        { name: 'redacted', type: 'bool', required: false },
        // ProcurementDraft (parseProcurementDraft-normaliserat), null vid AI-fel.
        { name: 'analysis', type: 'json', required: false, maxSize: 60000 },
        { name: 'analysis_model', type: 'text', required: false, max: 80 },
        { name: 'analyzed_at', type: 'date', required: false },
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
        'CREATE INDEX idx_procurement_documents_tenant ON procurement_documents (tenant)',
        'CREATE INDEX idx_procurement_documents_procurement ON procurement_documents (procurement)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('procurement_documents'));
    } catch (e) {
      /* ignore */
    }
  }
);
