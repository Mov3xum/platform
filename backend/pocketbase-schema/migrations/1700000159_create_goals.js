/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 42 — Målstyrning & verksamhetsplan. Ett målträd per
// verksamhetsår: goal_periods (år) → goals (fokusområde, ägande team) →
// goal_indicators (mätkälla: beräknad ur metrikregistret eller manuell
// bedömning) → goal_status_entries (kvartalsstatus). Ersätter PowerPoint-
// uppföljningen "I fas / Försenad / Ej startad / Klar".
//
// Select-värdena MÅSTE spegla packages/shared/src/goals.ts. Filnumret
// fortsätter efter staging-branchens migrationsserie.
//
// RLS: list/view staff/observer (tenant-bred verksamhetsstyrning — en ren
// startup_member ser inte Movexums interna mål); createRule roll-lös
// (§ 21.3, roll enforce:as i skrivlagret); periods/goals/indicators ändras
// av admin/incubator_lead, kvartalsstatus av hela staben (varje team
// rapporterar sina mål). Ingen PII: mål, tal, teamnamn.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

const FOCUS_AREAS = [
  'partner_finansiering',
  'inflode_varumarke',
  'kundvarde_kvalitet',
  'organisation_digitalisering',
  'tematisk_accelerator'
];
const OWNER_TEAMS = ['ledning', 'marknad', 'projekt', 'coach', 'gemensamt'];

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const tenantField = {
      name: 'tenant',
      type: 'relation',
      required: true,
      collectionId: tenantsCol.id,
      cascadeDelete: true,
      minSelect: 1,
      maxSelect: 1
    };
    const userField = (name) => ({
      name,
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    const autodate = [
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ];

    const periods = new Collection({
      id: 'goal_periods_collection',
      name: 'goal_periods',
      type: 'base',
      fields: [
        ...autodate,
        tenantField,
        { name: 'year', type: 'number', required: true, onlyInt: true, min: 2000, max: 2100 },
        { name: 'title', type: 'text', required: false, max: 120 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'active', 'closed'] },
        userField('created_by')
      ],
      indexes: ['CREATE UNIQUE INDEX idx_goal_periods_tenant_year ON goal_periods (tenant, year)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    app.save(periods);

    const goals = new Collection({
      id: 'goals_collection',
      name: 'goals',
      type: 'base',
      fields: [
        ...autodate,
        tenantField,
        {
          name: 'period',
          type: 'relation',
          required: true,
          collectionId: periods.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'focus_area', type: 'select', required: true, maxSelect: 1, values: FOCUS_AREAS },
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        { name: 'description', type: 'text', required: false, max: 2000 },
        { name: 'owner_team', type: 'select', required: true, maxSelect: 1, values: OWNER_TEAMS },
        { name: 'sort_order', type: 'number', required: false, onlyInt: true, min: 0, max: 100000 },
        userField('created_by')
      ],
      indexes: [
        'CREATE INDEX idx_goals_tenant ON goals (tenant)',
        'CREATE INDEX idx_goals_period ON goals (period)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    app.save(goals);

    const indicators = new Collection({
      id: 'goal_indicators_collection',
      name: 'goal_indicators',
      type: 'base',
      fields: [
        ...autodate,
        tenantField,
        {
          name: 'goal',
          type: 'relation',
          required: true,
          collectionId: goals.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'label', type: 'text', required: true, min: 1, max: 200 },
        // computed = värdet läses ur metrikregistret (metric_key), manual =
        // kvartalsvis mänsklig bedömning. En indikator har EN källa.
        { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['computed', 'manual'] },
        { name: 'metric_key', type: 'text', required: false, max: 60 },
        { name: 'target', type: 'number', required: false },
        { name: 'unit', type: 'select', required: true, maxSelect: 1, values: ['count', 'pct', 'days', 'bool'] },
        { name: 'direction', type: 'select', required: true, maxSelect: 1, values: ['higher', 'lower'] },
        { name: 'sort_order', type: 'number', required: false, onlyInt: true, min: 0, max: 100000 },
        userField('created_by')
      ],
      indexes: [
        'CREATE INDEX idx_goal_indicators_tenant ON goal_indicators (tenant)',
        'CREATE INDEX idx_goal_indicators_goal ON goal_indicators (goal)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    app.save(indicators);

    const entries = new Collection({
      id: 'goal_status_entries_collection',
      name: 'goal_status_entries',
      type: 'base',
      fields: [
        ...autodate,
        tenantField,
        {
          name: 'indicator',
          type: 'relation',
          required: true,
          collectionId: indicators.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'quarter', type: 'number', required: true, onlyInt: true, min: 1, max: 4 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['on_track', 'delayed', 'not_started', 'done']
        },
        // Uppmätt/bedömt värde vid statustillfället (beräknade indikatorer
        // får sitt värde ur registret av skrivlagret — aldrig manuellt).
        { name: 'value', type: 'number', required: false },
        { name: 'comment', type: 'text', required: false, max: 2000 },
        userField('recorded_by')
      ],
      indexes: [
        'CREATE INDEX idx_goal_status_entries_tenant ON goal_status_entries (tenant)',
        'CREATE UNIQUE INDEX idx_goal_status_entries_unique ON goal_status_entries (tenant, indicator, quarter)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    return app.save(entries);
  },
  (app) => {
    for (const name of ['goal_status_entries', 'goal_indicators', 'goals', 'goal_periods']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
