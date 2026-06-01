/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — bredda compass-RBAC så att `coach` (utöver admin och
// incubator_lead) kan hantera moduler + leads, och rätta operatorerna till
// `:each ?=` (PB v0.23.4-buggen, CLAUDE.md § 21.3 — `?=` matchar inte
// multi-value-fält som @request.auth.roles tyst).
//
// Mönster (som migration 1700000049/1700000096): roll-enforcement i
// list/view/update/delete + server-actions. createRules hålls fria från
// roll-checks (bara auth + tenant) för att aldrig fastna på operator-buggen —
// server-actionerna gör roll-kontrollen. De PUBLIKA flödena skriver via
// superuser (bypassar reglerna helt), så create-reglerna rör dem inte.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';
const ADMIN = '@request.auth.roles:each ?= "admin"';

function setRules(app, name, rules) {
  try {
    const col = app.findCollectionByNameOrId(name);
    for (const k of Object.keys(rules)) {
      col[k] = rules[k];
    }
    app.save(col);
  } catch (e) {
    // ignore — saknad kollektion i en testmiljö ska inte fälla migrationen
  }
}

migrate(
  (app) => {
    // Tenant-isolerade staff-kollektioner (leads + sessioner).
    for (const name of ['compass_leads', 'compass_conversations']) {
      setRules(app, name, {
        listRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
        viewRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
        createRule: `${ANY_AUTH} && ${TENANT}`,
        updateRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
        deleteRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`
      });
    }

    // Meddelanden + svar (ingen tenant-kolumn — staff-läsning via roll).
    for (const name of ['compass_messages', 'compass_responses']) {
      setRules(app, name, {
        listRule: `${ANY_AUTH} && ${STAFF}`,
        viewRule: `${ANY_AUTH} && ${STAFF}`,
        createRule: ANY_AUTH,
        updateRule: `${ANY_AUTH} && ${STAFF}`,
        deleteRule: `${ANY_AUTH} && ${STAFF}`
      });
    }

    // Moduler: läsning tenant-bred (alla i tenanten), skrivning staff.
    setRules(app, 'compass_modules', {
      listRule: `${ANY_AUTH} && ${TENANT}`,
      viewRule: `${ANY_AUTH} && ${TENANT}`,
      createRule: `${ANY_AUTH} && ${TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`
    });

    // Frågor: läsning för inloggade, skrivning staff.
    setRules(app, 'compass_questions', {
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: ANY_AUTH,
      updateRule: `${ANY_AUTH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${STAFF}`
    });

    // Källor (gemensam lookup, ingen tenant).
    setRules(app, 'compass_lead_sources', {
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${STAFF}`,
      updateRule: `${ANY_AUTH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${STAFF}`
    });

    // Säkerhetslogg: staff läser i sin tenant; create/update bara via server
    // (superuser); delete kräver admin.
    setRules(app, 'compass_security_events', {
      listRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
      viewRule: `${ANY_AUTH} && ${TENANT} && ${STAFF}`,
      createRule: null,
      updateRule: null,
      deleteRule: `${ANY_AUTH} && ${TENANT} && ${ADMIN}`
    });
  },
  (app) => {
    // Down: återställ till admin/incubator_lead-only (utan coach), behåll
    // dock `:each ?=` (det korrekta operatorn — vi rullar inte tillbaka till
    // den buggiga `?=`).
    const STAFF_OLD =
      '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
    for (const name of ['compass_leads', 'compass_conversations']) {
      setRules(app, name, {
        listRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
        viewRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
        createRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
        updateRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
        deleteRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`
      });
    }
    for (const name of ['compass_messages', 'compass_responses']) {
      setRules(app, name, {
        listRule: `${ANY_AUTH} && ${STAFF_OLD}`,
        viewRule: `${ANY_AUTH} && ${STAFF_OLD}`,
        createRule: `${ANY_AUTH} && ${STAFF_OLD}`,
        updateRule: `${ANY_AUTH} && ${STAFF_OLD}`,
        deleteRule: `${ANY_AUTH} && ${STAFF_OLD}`
      });
    }
    setRules(app, 'compass_modules', {
      listRule: `${ANY_AUTH} && ${TENANT}`,
      viewRule: `${ANY_AUTH} && ${TENANT}`,
      createRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
      updateRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT} && ${STAFF_OLD}`
    });
    setRules(app, 'compass_questions', {
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${STAFF_OLD}`,
      updateRule: `${ANY_AUTH} && ${STAFF_OLD}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_OLD}`
    });
    setRules(app, 'compass_lead_sources', {
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${STAFF_OLD}`,
      updateRule: `${ANY_AUTH} && ${STAFF_OLD}`,
      deleteRule: `${ANY_AUTH} && ${STAFF_OLD}`
    });
  }
);
