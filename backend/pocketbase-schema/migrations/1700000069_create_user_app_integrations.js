/// <reference path="../pb_data/types.d.ts" />

// Per-user OAuth-integrationer mot tredjepartstjänster (Microsoft Graph,
// Google, GitHub osv). Skild från `tenant_integrations` som är tenant-
// nivå och från `user_mistral_connectors` som är aktiveringsstatus för
// Mistrals workspace-connectors.
//
// CLAUDE.md § 10.3 (ISO 27001 A.8.24): `auth_data` är AES-256-GCM-
// krypterad blob med access_token + refresh_token. Klartext lagras
// aldrig. `last_error` är PII-fri felmeddelande för debug.
//
// CLAUDE.md § 10.2 (GDPR): Alla provider-endpoints måste vara EU/EFTA.
// För Microsoft Graph: använd `https://graph.microsoft.com` (deras
// EU-region väljs automatiskt baserat på användarens tenant). För
// utvärdering av residency, dokumentera per provider i 11.3.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = user';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'user_app_integrations_col',
      name: 'user_app_integrations',
      type: 'base',
      fields: [
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
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Provider-slug: 'outlook_calendar', 'google_calendar', 'github' osv.
        { name: 'provider', type: 'text', required: true, max: 60 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['active', 'oauth_pending', 'expired', 'disabled']
        },
        // AES-256-GCM-krypterad blob ({iv, tag, ciphertext}) med
        // access_token, refresh_token, expires_at (ISO string), scope.
        { name: 'auth_data', type: 'json', required: false, maxSize: 8000 },
        // Frisktext-display från providern (t.ex. e-postadress från
        // Microsoft Graph /me) — för UI utan att dekryptera tokens.
        { name: 'account_label', type: 'text', required: false, max: 200 },
        { name: 'connected_at', type: 'date', required: false },
        { name: 'last_sync_at', type: 'date', required: false },
        { name: 'last_error', type: 'text', required: false, max: 500 },
        // Visa connectorn som chip på /idag — separat pin-state per
        // provider eftersom dessa är distinkta från Mistral-connectors.
        { name: 'is_pinned', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_uai_unique ON user_app_integrations (user, provider)',
        'CREATE INDEX idx_uai_tenant ON user_app_integrations (tenant)',
        'CREATE INDEX idx_uai_user ON user_app_integrations (user)'
      ],
      // Användare ser och hanterar bara sina egna rader. Staff kan läsa
      // för audit. Skrivs av användaren själv eller av server actions
      // via PB superuser vid OAuth-callback.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${OWNER_MATCH} || ${STAFF_ROLES})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${OWNER_MATCH} || ${STAFF_ROLES})`,
      createRule: `${ANY_AUTH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('user_app_integrations'));
    } catch (e) {
      /* ignore */
    }
  }
);
