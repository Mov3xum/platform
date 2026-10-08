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
// - VARJE createRule på en kollektion med `tenant`-fält kräver
//   `@request.body.tenant = @request.auth.tenant` — tidigare kunde en inloggad
//   användare skapa poster (uppgifter, audit-rader, AI-förbrukning, notiser …)
//   som bar en ANNAN tenants id. Befintliga ägar-/skaparvillkor behålls.
// - avtals-PDF:er och personliga filer kräver fil-token (protected).
//
// Saknas en kollektion (migration-only-familjer som inte körts) hoppas den
// över. Down återställer INTE de lösa reglerna (de var en sårbarhet).

const RULES = {
  "startups": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "alumni": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "investors": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "partners": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "missions": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.id = issuer || @request.auth.id = mentor || recipients:each ?= @request.auth.id)",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_financials": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_phase_history": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "deals": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "incubator_events": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "event_signups": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "service_time_entries": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_service_costs": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_state_aid_periods": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_readiness_assessments": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
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
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.linked_startups:each ?= startup)",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tools": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tool_runs": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = triggered_by"
  },
  "workshops": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "workshop_runs": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = triggered_by"
  },
  "workshop_assignments": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = assigned_by"
  },
  "strategies": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup) && deleted_at = \"\"",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\") || (@request.auth.roles:each ?= \"startup_member\" && @request.auth.linked_startups:each ?= startup.id))",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "workshop_areas": {
    "updateRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\")",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && (@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\")",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "de_minimis_units": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "de_minimis_stod": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= startup)",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "de_minimis_unit_orgnr": {
    "listRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= unit.startup)",
    "viewRule": "@request.auth.id != \"\" && @request.auth.tenant = tenant && ((@request.auth.roles:each ?= \"admin\" || @request.auth.roles:each ?= \"incubator_lead\" || @request.auth.roles:each ?= \"coach\" || @request.auth.roles:each ?= \"mentor\" || @request.auth.roles:each ?= \"observer\") || @request.auth.linked_startups:each ?= unit.startup)",
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
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
  },
  "mission_comments": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = author"
  },
  "user_mistral_connectors": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = user"
  },
  "user_app_integrations": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.user = @request.auth.id"
  },
  "ai_usage_events": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = user"
  },
  "tool_run_feedback": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = user"
  },
  "agent_actions": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = actor"
  },
  "chat_threads": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = owner"
  },
  "deep_jobs": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = owner"
  },
  "user_files": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = owner"
  },
  "user_file_chunks": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = owner"
  },
  "meeting_transcripts": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.auth.id = owner"
  },
  "support_check_applications": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id && (@request.body.status:isset = false || @request.body.status = \"draft\") && (@request.body.funding_project:isset = false && @request.body.funding_work_package:isset = false && @request.body.state_aid_basis:isset = false && @request.body.funding_note:isset = false && @request.body.funding_set_by:isset = false && @request.body.funding_set_at:isset = false && @request.body.approved_amount_sek:isset = false && @request.body.decision_note:isset = false && @request.body.decided_by:isset = false && @request.body.decided_at:isset = false && @request.body.paid_at:isset = false && @request.body.paid_amount_sek:isset = false && @request.body.paid_note:isset = false && @request.body.de_minimis_stod:isset = false && @request.body.capital_round:isset = false) && (@request.body.changes_request_note:isset = false && @request.body.changes_requested_by:isset = false && @request.body.coach_statement:isset = false && @request.body.coach_statement_by:isset = false && @request.body.coach_statement_at:isset = false && @request.body.controller_statement:isset = false && @request.body.controller_statement_by:isset = false && @request.body.controller_statement_at:isset = false && @request.body.assessment_scores:isset = false && @request.body.assessment_score:isset = false && @request.body.assessed_by:isset = false && @request.body.assessed_at:isset = false && @request.body.is_excellence_activity:isset = false && @request.body.report_due_at:isset = false)"
  },
  "support_check_revisions": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.signer = @request.auth.id"
  },
  "support_check_comments": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.author = @request.auth.id"
  },
  "support_check_documents": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant && @request.body.uploaded_by = @request.auth.id"
  },
  "mission_documents": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tool_versions": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tool_knowledge": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "workshop_media": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "strategy_revisions": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "sprint_x_checkins": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "incubator_reports": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tenant_integrations": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "startup_ownership": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "capital_rounds": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "intellectual_property": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "tasks": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "contacts": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "contact_requests": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "education_documents": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "education_document_assignments": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "onboarding_flows": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "onboarding_progress": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "compass_leads": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "compass_conversations": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "compass_modules": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "compass_brand": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "annual_wheel_items": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "annual_wheel_categories": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "org_post_media": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "procurements": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "procurement_calloffs": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "procurement_rules": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "procurement_documents": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "goal_periods": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "goals": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "goal_indicators": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "goal_status_entries": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "funding_projects": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "funding_work_packages": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "support_check_types": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
  },
  "support_check_rules": {
    "createRule": "@request.auth.id != \"\" && @request.body.tenant = @request.auth.tenant"
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
