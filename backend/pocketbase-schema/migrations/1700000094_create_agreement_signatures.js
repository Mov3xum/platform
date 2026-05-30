/// <reference path="../pb_data/types.d.ts" />

// Oföränderligt signeringsbevis per part och avtal — den rättsligt bärande
// posten i in-app-signeringen (avancerad elektronisk signatur, eIDAS art. 26):
//
//   (a) unikt knuten till signatären   → signer (user-id) + signer_email
//   (b) kan identifiera signatären     → signer_name + signer_email + signer
//   (c) skapad med medel under signatärens egen kontroll
//                                      → autentiserad session (httpOnly-cookie)
//   (d) knuten till de signerade data så att efterföljande ändring upptäcks
//                                      → document_hash (SHA-256 av PDF:ens bytes)
//
// Plus avsikt (intent_text — uttrycklig bindande avsiktsförklaring),
// UTC-tidsstämpel och ip_hash (SHA-256 av IP — dataminimerad, inte klartext).
//
// Immutabilitet (ISO 27001 A.8.32): update/delete = endast superuser (tomma
// regler). En part = en signatur (unikt index agreement+party). Behörigheten
// (staff för Movexum-parten / länkad bolagsmedlem för company-parten) enforce:as
// i server-actionen; bolagsmedlemmens skrivning sker via superuser-fallback
// (samma mönster som education_documents, PB v0.23 rule-eval-bugg).
//
// PII: signer_email + ip_hash → kollektionen denylistas i lib/ai/redaction.ts.
// GDPR art. 17: cascadeDelete på tenant/agreement/startup.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'agreement_signatures_collection',
      name: 'agreement_signatures',
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
          name: 'agreement',
          type: 'relation',
          required: true,
          collectionId: 'agreements_collection',
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
          name: 'signer',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'party',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['company', 'movexum']
        },
        { name: 'signer_name', type: 'text', required: true, max: 200 },
        { name: 'signer_email', type: 'text', required: false, max: 200 },
        { name: 'document_hash', type: 'text', required: true, max: 128 },
        { name: 'signed_at', type: 'date', required: true },
        { name: 'ip_hash', type: 'text', required: false, max: 128 },
        { name: 'user_agent', type: 'text', required: false, max: 300 },
        { name: 'intent_text', type: 'text', required: false, max: 500 },
        {
          name: 'method',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['aes', 'bankid']
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_agreement_signatures_party ON agreement_signatures (agreement, party)',
        'CREATE INDEX idx_agreement_signatures_startup ON agreement_signatures (startup)',
        'CREATE INDEX idx_agreement_signatures_tenant ON agreement_signatures (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      // Staff får skapa via regel; bolagsmedlemmens signatur skrivs via
      // server-action + superuser-fallback efter behörighetskontroll.
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      // Oföränderligt: bara superuser kan ändra/radera (audit-integritet).
      updateRule: null,
      deleteRule: null
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('agreement_signatures');
    return app.delete(collection);
  }
);
