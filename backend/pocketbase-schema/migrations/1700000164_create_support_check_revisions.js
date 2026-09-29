/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.4 — Oföränderliga revisioner + signeringsbevis för en
// stödcheckansökan. Varje inskick (första och varje komplettering) fryser en
// snapshot av ansökan (insatser, belopp, bilage-id:n) och firmatecknarens
// AES-signatur (eIDAS art. 26 — samma bevismodell som `agreement_signatures`,
// § 19): identitet (signer + namn + e-post), avsikt (`intent_text`), vad
// (`document_hash` = SHA-256 av den kanoniska snapshoten) och när (UTC).
// Beslutet pekar på ett revisionsnummer, så det alltid är klart vilken
// version som beviljades. update/delete = ENDAST superuser (audit-
// integritet, ISO 27001 A.8.32). Unikt index (application, revision).
//
// RLS: medlem-scopad via `startup` (bolaget ser sina egna bevis),
// staff/observer hela tenanten. createRule roll-lös (§ 21.3) — skrivningen
// görs av skrivlagret efter verifierad behörighet. ip lagras BARA som
// SHA-256-hash (GDPR § 5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const MEMBER = '@request.auth.linked_startups:each ?= startup';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const applicationsCol = app.findCollectionByNameOrId('support_check_applications');

    const collection = new Collection({
      id: 'support_check_revisions_collection',
      name: 'support_check_revisions',
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
        { name: 'revision', type: 'number', required: true, onlyInt: true, min: 1 },
        // SupportCheckRevisionSnapshot (kanonisk).
        { name: 'snapshot', type: 'json', required: true, maxSize: 80000 },
        { name: 'document_hash', type: 'text', required: true, min: 64, max: 64 },
        {
          name: 'signer',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'signer_name', type: 'text', required: true, min: 1, max: 200 },
        { name: 'signer_email', type: 'text', required: false, max: 200 },
        { name: 'signed_at', type: 'date', required: true },
        { name: 'ip_hash', type: 'text', required: false, max: 64 },
        { name: 'user_agent', type: 'text', required: false, max: 300 },
        { name: 'intent_text', type: 'text', required: true, max: 1000 },
        { name: 'method', type: 'select', required: true, maxSelect: 1, values: ['aes', 'bankid'] }
      ],
      indexes: [
        'CREATE INDEX idx_support_check_revisions_tenant ON support_check_revisions (tenant)',
        'CREATE INDEX idx_support_check_revisions_startup ON support_check_revisions (startup)',
        'CREATE UNIQUE INDEX idx_support_check_revisions_unique ON support_check_revisions (application, revision)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER})`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: null,
      deleteRule: null
    });
    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('support_check_revisions'));
    } catch (e) {
      /* ignore */
    }
  }
);
