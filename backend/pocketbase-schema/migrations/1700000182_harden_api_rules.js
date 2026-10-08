/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 21.8 — säkerhetshärdning av PocketBase-regler (2026-10-08).
//
// ORDAGRANN KOPIA av scripts/security-rules.mjs (PB:s JSVM kan inte importera
// ES-moduler). scripts/security-rules.test.mjs låser att de är identiska —
// ändra ALDRIG här utan att ändra där (och skriv i så fall en NY migration;
// denna är oföränderlig när den väl applicerats, ISO 27001 A.8.32).
//
// Vad som rättas:
// - update/delete-regler som setup-via-api.mjs skrivit över med `auth && tenant`
//   UTAN rollkontroll (bl.a. startups, tools, missions, events, workshops) —
//   varje inloggad, även startup_member/observer, kunde ändra dem direkt mot
//   PB-API:t.
// - de minimis-kollektionernas list/view återfår bolagsisoleringen (§ 21).
// - globala kollektioner (de_minimis_regelverk, integration_providers,
//   web_cache) kan inte längre skapas/förgiftas av användare.
// - tenants.updateRule gäller bara den egna tenanten, även för admin.
// - createRules pinnar tenant + skapare (created_by/author/signer) så ingen kan
//   förfalska en annan användares post (t.ex. ett schema som körs med admins
//   rättigheter, eller ett eIDAS-signeringsbevis).
// - avtals-PDF:er och personliga filer kräver fil-token (protected).
//
// Saknas en kollektion (migration-only-familjer som inte körts) hoppas den
// över. Down återställer INTE de lösa reglerna (de var en sårbarhet).

const RULES = {
  "startups": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "alumni": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "investors": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "partners": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "missions": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.id = issuer || @request.auth.id = mentor || recipients:each ?= @request.auth.id)"
  },
  "startup_financials": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_phase_history": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "deals": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "incubator_events": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "event_signups": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "service_time_entries": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_service_costs": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_state_aid_periods": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_readiness_assessments": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "milestones": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = startup.tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "partner_engagements": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = startup.tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_team_members": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = startup.tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "startup_kpis": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.linked_startups:each ?= startup)"
  },
  "tools": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")"
  },
  "tool_runs": {
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")"
  },
  "workshops": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")"
  },
  "workshop_runs": {
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "workshop_assignments": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\") || (@request.auth.roles:each ?= \"startup_member\" && @request.auth.linked_startups:each ?= startup.id))",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")"
  },
  "strategies": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup) && deleted_at = \"\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\") || (@request.auth.roles:each ?= \"startup_member\" && @request.auth.linked_startups:each ?= startup.id))"
  },
  "workshop_areas": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")"
  },
  "de_minimis_units": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)"
  },
  "de_minimis_stod": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)"
  },
  "de_minimis_unit_orgnr": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= unit.startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= unit.startup)"
  },
  "de_minimis_regelverk": {
    "createRule": null
  },
  "integration_providers": {
    "createRule": null
  },
  "web_cache": {
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  },
  "tenants": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = id && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")"
  },
  "notifications": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && (actor = \"\" || @request.auth.id = actor)"
  },
  "tool_schedules": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id"
  },
  "tool_triggers": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id"
  },
  "agent_memory": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id"
  },
  "org_knowledge": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id"
  },
  "org_knowledge_chunks": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "agreement_signatures": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.signer = @request.auth.id"
  },
  "org_posts": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.author = @request.auth.id"
  },
  "feedback_items": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.author = @request.auth.id"
  },
  "surveys": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id && @request.body.send_at:isset = false && @request.body.send_base_url:isset = false && @request.body.is_active = false"
  }
};

const PROTECTED_FILE_FIELDS = {
  "agreements": [
    "file"
  ],
  "user_files": [
    "file"
  ]
};

migrate(
  (app) => {
    for (const [name, rules] of Object.entries(RULES)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      for (const [key, value] of Object.entries(rules)) {
        col[key] = value;
      }
      app.save(col);
    }
    for (const [name, fields] of Object.entries(PROTECTED_FILE_FIELDS)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      for (const fieldName of fields) {
        const field = col.fields.getByName(fieldName);
        if (field) field.protected = true;
      }
      app.save(col);
    }
  },
  () => {
    // Medvetet ingen återställning: de tidigare reglerna var en sårbarhet.
  }
);
