/// <reference path="../pb_data/types.d.ts" />

// CRM-arket "Personer" — externa kontakter som inte är inloggade Movexum-
// användare (rådgivare, mentorer utan plattformskonto, jurymedlemmar,
// kommunala samordnare). Skild från:
//   • `users`               — autentiserade Movexum-konton
//   • `startup_team_members`— grundare/anställda 1:1-tied till ETT bolag
//
// `contacts` är M2M mot startups via `startup_contacts` (1700000072).
//
// GDPR-överväganden (CLAUDE.md § 10.2):
//   • Rättslig grund = berättigat intresse (inkubatordrift, mentormatchning)
//   • `gdpr_consent`-fält dokumenterar att personen har godkänt lagring
//     (Excel-kolumn "Personen har godkänt lagring av information enligt
//     GDPR"). Krävs innan rad får skapas i UI:t — server action validerar.
//   • `phone`, `email` = PII, exkluderas från ALL AI-kontext (svartlista i
//     apps/web/src/lib/ai/context.ts).
//   • `gender` = GDPR art. 9 särskild kategori → blockerad i AI-kontext.
//   • Personnummer lagras ALDRIG.
//   • Vid radering av tenant cascade-deletes inte automatiskt — kontakter
//     är portabla mellan tenants i framtiden. Tenant-isolation enforcas
//     i listRule.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    const collection = new Collection({
      id: 'contacts_collection',
      name: 'contacts',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'first_name', type: 'text', required: true, min: 1, max: 100 },
        { name: 'last_name', type: 'text', required: true, min: 1, max: 100 },
        // PII — ej i AI-kontext.
        { name: 'email', type: 'email', required: false },
        // PII — ej i AI-kontext.
        { name: 'phone', type: 'text', required: false, max: 30 },
        // Excel: "Ordinarie roll" — frisktext (t.ex. "Affärscoach", "Jurist").
        { name: 'primary_role', type: 'text', required: false, max: 100 },
        // GDPR art. 9 särskild kategori — ej i AI-kontext.
        {
          name: 'gender',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['kvinna', 'man', 'icke_binar', 'uppger_ej']
        },
        // Frisktext, komma-separerad — Excel: "Kompetenser".
        { name: 'skills', type: 'text', required: false, max: 1000 },
        // GDPR — måste vara true för att raden ska få skapas (server action).
        { name: 'gdpr_consent', type: 'bool', required: false },
        { name: 'gdpr_consent_at', type: 'date', required: false },
        // Excel: "Kommuntillhörighet" — kommun där kontakten är aktiv.
        { name: 'kommun', type: 'text', required: false, max: 100 },
        // Excel: "Info" — fri anteckning. Får INTE innehålla PII-detaljer
        // utöver vad personen samtyckt till; sökbar via PB-fulltext.
        { name: 'info', type: 'editor', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_contacts_tenant ON contacts (tenant)',
        'CREATE INDEX idx_contacts_last_name ON contacts (last_name)',
        'CREATE INDEX idx_contacts_email ON contacts (email)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('contacts'));
    } catch (e) {
      /* ignore */
    }
  }
);
