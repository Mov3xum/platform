/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — modul som ersätter den tidigare Sprint X-portföljvyn
// på /kompassen. Skapar leads-intake, AI-chat, moduler/frågor och
// säkerhets-loggning, allt tenant-isolerat enligt plattformens RBAC.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');

    // 1. Källor (publik lookup, ingen tenant-isolation — gemensam)
    const leadSources = new Collection({
      id: 'compass_lead_sources_collection',
      name: 'compass_lead_sources',
      type: 'base',
      fields: [
        { name: 'key', type: 'text', required: true, min: 1, max: 50 },
        { name: 'label', type: 'text', required: true, max: 100 },
        { name: 'icon', type: 'text', required: false, max: 50 },
        { name: 'color', type: 'text', required: false, max: 20 },
        { name: 'sort_order', type: 'number', required: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_compass_lead_sources_key ON compass_lead_sources (key)'
      ],
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_ROLES}`
    });
    app.save(leadSources);

    // 2. Leads (per tenant — startup-kandidater innan onboarding)
    const leads = new Collection({
      id: 'compass_leads_collection',
      name: 'compass_leads',
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
        { name: 'name', type: 'text', required: true, min: 1, max: 200 },
        { name: 'email', type: 'email', required: false },
        { name: 'phone', type: 'text', required: false, max: 50 },
        { name: 'organization', type: 'text', required: false, max: 200 },
        { name: 'idea_summary', type: 'text', required: false, max: 4000 },
        { name: 'idea_category', type: 'text', required: false, max: 100 },
        { name: 'source_key', type: 'text', required: true, max: 50 },
        { name: 'source_detail', type: 'text', required: false, max: 200 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['new', 'contacted', 'meeting-booked', 'evaluating', 'accepted', 'declined']
        },
        {
          name: 'score',
          type: 'number',
          required: false,
          min: 0,
          max: 100
        },
        { name: 'score_reasoning', type: 'text', required: false, max: 4000 },
        {
          name: 'assigned_to',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'notes', type: 'text', required: false, max: 8000 },
        {
          name: 'tags',
          type: 'select',
          required: false,
          maxSelect: 12,
          values: [
            'sustainable',
            'tech',
            'service',
            'product',
            'local',
            'international',
            'student',
            'researcher',
            'female-led',
            'social-impact',
            'b2b',
            'b2c'
          ]
        },
        { name: 'consent_at', type: 'date', required: false },
        { name: 'last_contact_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_compass_leads_tenant_status ON compass_leads (tenant, status)',
        'CREATE INDEX idx_compass_leads_tenant_created ON compass_leads (tenant, created)',
        'CREATE INDEX idx_compass_leads_tenant_source ON compass_leads (tenant, source_key)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(leads);

    // 3. Conversations (chatt-sessioner; lead_id är optional — chatten
    //    kan börja innan leadet skapas)
    const conversations = new Collection({
      id: 'compass_conversations_collection',
      name: 'compass_conversations',
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
          name: 'lead',
          type: 'relation',
          required: false,
          collectionId: 'compass_leads_collection',
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'module_slug', type: 'text', required: false, max: 100 },
        { name: 'session_token', type: 'text', required: false, max: 100 },
        { name: 'visitor_ip_hash', type: 'text', required: false, max: 100 },
        { name: 'extracted_data', type: 'json', required: false, maxSize: 200000 },
        { name: 'status', type: 'select', required: false, maxSelect: 1, values: ['active', 'completed', 'abandoned'] }
      ],
      indexes: [
        'CREATE INDEX idx_compass_conv_tenant_created ON compass_conversations (tenant, created)',
        'CREATE INDEX idx_compass_conv_lead ON compass_conversations (lead)',
        'CREATE INDEX idx_compass_conv_session ON compass_conversations (session_token)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(conversations);

    // 4. Messages (chat-meddelanden — bara staff läser)
    const messages = new Collection({
      id: 'compass_messages_collection',
      name: 'compass_messages',
      type: 'base',
      fields: [
        {
          name: 'conversation',
          type: 'relation',
          required: true,
          collectionId: 'compass_conversations_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['user', 'assistant', 'system'] },
        { name: 'content', type: 'text', required: true, max: 20000 },
        { name: 'tokens_in', type: 'number', required: false, min: 0 },
        { name: 'tokens_out', type: 'number', required: false, min: 0 },
        { name: 'model', type: 'text', required: false, max: 100 }
      ],
      indexes: [
        'CREATE INDEX idx_compass_msg_conv ON compass_messages (conversation, created)'
      ],
      listRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_ROLES}`
    });
    app.save(messages);

    // 5. Modules (intag-flöden — chat eller wizard)
    const modules = new Collection({
      id: 'compass_modules_collection',
      name: 'compass_modules',
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
        { name: 'slug', type: 'text', required: true, min: 1, max: 100 },
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'description', type: 'text', required: false, max: 1000 },
        { name: 'flow_type', type: 'select', required: true, maxSelect: 1, values: ['chat', 'wizard', 'quiz'] },
        { name: 'system_prompt', type: 'editor', required: false },
        { name: 'consent_note', type: 'text', required: false, max: 2000 },
        { name: 'is_active', type: 'bool', required: false },
        {
          name: 'model',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest']
        },
        { name: 'sort_order', type: 'number', required: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_compass_modules_tenant_slug ON compass_modules (tenant, slug)',
        'CREATE INDEX idx_compass_modules_tenant_active ON compass_modules (tenant, is_active)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(modules);

    // 6. Questions (frågor inom moduler)
    const questions = new Collection({
      id: 'compass_questions_collection',
      name: 'compass_questions',
      type: 'base',
      fields: [
        {
          name: 'module',
          type: 'relation',
          required: true,
          collectionId: 'compass_modules_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'key', type: 'text', required: true, max: 100 },
        { name: 'prompt', type: 'text', required: true, max: 2000 },
        { name: 'help_text', type: 'text', required: false, max: 1000 },
        {
          name: 'input_type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['short_text', 'long_text', 'choice', 'multi_choice', 'scale', 'email', 'phone']
        },
        { name: 'choices', type: 'json', required: false, maxSize: 50000 },
        { name: 'required', type: 'bool', required: false },
        { name: 'sort_order', type: 'number', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_compass_questions_module_sort ON compass_questions (module, sort_order)',
        'CREATE UNIQUE INDEX idx_compass_questions_module_key ON compass_questions (module, key)'
      ],
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_ROLES}`
    });
    app.save(questions);

    // 7. Responses (svar)
    const responses = new Collection({
      id: 'compass_responses_collection',
      name: 'compass_responses',
      type: 'base',
      fields: [
        {
          name: 'conversation',
          type: 'relation',
          required: true,
          collectionId: 'compass_conversations_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'question',
          type: 'relation',
          required: true,
          collectionId: 'compass_questions_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'value', type: 'text', required: false, max: 8000 },
        { name: 'value_json', type: 'json', required: false, maxSize: 200000 }
      ],
      indexes: [
        'CREATE INDEX idx_compass_responses_conv ON compass_responses (conversation)',
        'CREATE INDEX idx_compass_responses_q ON compass_responses (question)'
      ],
      listRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_ROLES}`
    });
    app.save(responses);

    // 8. Security events
    const securityEvents = new Collection({
      id: 'compass_security_events_collection',
      name: 'compass_security_events',
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
          name: 'actor',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'login',
            'logout',
            'invite_sent',
            'invite_accepted',
            'role_change',
            'lead_delete',
            'lead_export',
            'lead_erase',
            'module_publish',
            'module_unpublish',
            'brand_update',
            'failed_login',
            'rate_limit'
          ]
        },
        { name: 'subject', type: 'text', required: false, max: 200 },
        { name: 'meta', type: 'json', required: false, maxSize: 50000 },
        { name: 'ip_hash', type: 'text', required: false, max: 100 }
      ],
      indexes: [
        'CREATE INDEX idx_compass_sec_tenant_created ON compass_security_events (tenant, created)',
        'CREATE INDEX idx_compass_sec_kind ON compass_security_events (kind)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      // Skapas bara av server (service role) — ingen create från klient
      createRule: null,
      updateRule: null,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });
    app.save(securityEvents);

    // 9. Brand-settings (per tenant, key/value)
    const brand = new Collection({
      id: 'compass_brand_collection',
      name: 'compass_brand',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'key', type: 'text', required: true, max: 100 },
        { name: 'value', type: 'text', required: false, max: 4000 },
        { name: 'value_json', type: 'json', required: false, maxSize: 200000 }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_compass_brand_tenant_key ON compass_brand (tenant, key)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(brand);

    // 10. Seeda default lead-sources (gemensam lookup)
    const defaults = [
      { key: 'event', label: 'Event', icon: 'calendar', color: '#f0d22e', sort_order: 0 },
      { key: 'web', label: 'Webbformulär', icon: 'globe', color: '#00a8de', sort_order: 1 },
      { key: 'social', label: 'Sociala medier', icon: 'share', color: '#8e6fd6', sort_order: 2 },
      { key: 'referral', label: 'Rekommendation', icon: 'users', color: '#4a7d4a', sort_order: 3 },
      { key: 'call', label: 'Samtal', icon: 'phone', color: '#d67e47', sort_order: 4 },
      { key: 'ai-chat', label: 'AI-intag', icon: 'sparkles', color: '#002c40', sort_order: 5 }
    ];

    for (const row of defaults) {
      const rec = new Record(leadSources);
      rec.set('key', row.key);
      rec.set('label', row.label);
      rec.set('icon', row.icon);
      rec.set('color', row.color);
      rec.set('sort_order', row.sort_order);
      app.save(rec);
    }
  },
  (app) => {
    const names = [
      'compass_brand',
      'compass_security_events',
      'compass_responses',
      'compass_questions',
      'compass_modules',
      'compass_messages',
      'compass_conversations',
      'compass_leads',
      'compass_lead_sources'
    ];
    for (const n of names) {
      try {
        const c = app.findCollectionByNameOrId(n);
        app.delete(c);
      } catch (e) {
        // ignore missing
      }
    }
  }
);
