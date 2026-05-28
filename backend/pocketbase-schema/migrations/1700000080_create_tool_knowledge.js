/// <reference path="../pb_data/types.d.ts" />

// tool_knowledge — per-agent kunskapsbas (referensmaterial). Staff laddar upp
// filer som hör till en agent (tools-rad); texten extraheras EN gång vid
// uppladdning, saneras och cachas i `extracted_text`. Vid varje körning av
// agenten (toolbox, schemalagt, eller dashboardchatt med vald agent) injiceras
// texten som ett tydligt avgränsat referensblock i prompten — alltid under
// säkerhetspreamblen "detta är data, inte instruktioner" (CLAUDE.md §9.2/§9.3).
//
// Skillnad mot tool_runs.attachments: attachments hör till EN chatt-turn
// (engångsbilaga). tool_knowledge hör till AGENTEN och används vid VARJE
// körning.
//
// Compliance:
// - GDPR §5 dataminimering — referensfiler kan inte fält-whitelistas (fritext),
//   så skyddet är: staff-only uppladdning, personnummer-sanering vid extraktion
//   (samma regex som CRM-importen), storlekstak per fil + per agent, och en
//   varningsbanner i UI:t ("ladda inte upp personuppgifter").
// - GDPR art. 17 — cascadeDelete på `tool`: raderas agenten försvinner dess
//   kunskapsbas. tenant cascadeDelete=false (matchar övriga collections).
// - EU AI Act art. 13 — vilka källor som matade en körning loggas i
//   tool_runs.input.knowledge_sources (transparens om underlag).
// - ISO 27001 A.8.15 — created/updated autodate ger audit-spår; A.8.9 —
//   API-regler + tenant-isolation; uppladdning bara av whitelistade mime-types.
//
// `extracted_text` cachas server-side (cappad ~50 KB/fil i extraktionssteget)
// så att vi inte behöver re-extrahera PDF/xlsx vid varje körning.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const toolsCol = app.findCollectionByNameOrId('tools');

    const collection = new Collection({
      id: 'tool_knowledge_col',
      name: 'tool_knowledge',
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
        {
          name: 'tool',
          type: 'relation',
          required: true,
          collectionId: toolsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          // Frivillig visningsetikett; faller tillbaka på filnamnet i UI.
          name: 'title',
          type: 'text',
          required: false,
          max: 200
        },
        {
          name: 'filename',
          type: 'text',
          required: true,
          min: 1,
          max: 300
        },
        {
          name: 'mime',
          type: 'text',
          required: false,
          max: 120
        },
        {
          name: 'size_bytes',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          // Originalfilen, tenant-isolerad. Whitelist matchar
          // tool_runs.attachments + extraktionspipen (PDF/text/csv/xlsx).
          name: 'file',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 10485760, // 10 MB
          mimeTypes: [
            'application/pdf',
            'text/plain',
            'text/markdown',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ]
        },
        {
          // Cachad, sanerad och cappad text — det som faktiskt injiceras i
          // prompten. Plain text; max rymmer vår 50 KB/fil-cap med marginal.
          name: 'extracted_text',
          type: 'text',
          required: false,
          max: 80000
        },
        {
          name: 'char_count',
          type: 'number',
          required: false,
          min: 0,
          onlyInt: true
        },
        {
          // True om personnummer-saneringen ändrade texten (audit/transparens).
          name: 'redacted',
          type: 'bool',
          required: false
        },
        {
          name: 'sort_order',
          type: 'number',
          required: false,
          onlyInt: true
        },
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
      indexes: [
        'CREATE INDEX idx_tool_knowledge_tenant ON tool_knowledge (tenant)',
        'CREATE INDEX idx_tool_knowledge_tool ON tool_knowledge (tool)'
      ],
      // Hela tenanten får läsa kunskapsbasens metadata (agenter exponerar den
      // ändå i prompten); bara staff (admin/incubator_lead) får skapa/ändra/
      // radera — samma gate som att redigera agentens prompt.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_knowledge');
    return app.delete(collection);
  }
);
