/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX: återställ 'workshop_assignment' + 'workshop_run' i activities.kind.
// =============================================================================
//
// BAKGRUND: migration 1700000021 LADE TILL workshop-kinds i activities.kind,
// men migration 1700000049 (extend_tool_runs_with_assignment) ERSATTE sedan
// hela values-listan med en hårdkodad lista som saknade dem. Konsekvens på
// varje migrations-driven instans: `assignWorkshopToStartupAction` skapar
// tilldelningsraden men kraschar på activities-loggen ("Invalid value
// workshop_assignment") → admin får fel, raden saknar `activity`-länk, och
// AI-chatt-/slutför-flödena i workshops felar på samma enum.
//
// Den här migrationen ÅTERSTÄLLER värdena genom union (samma mönster som
// 1700000056) — befintliga värden bevaras, inget ersätts. Idempotent.
// setup-via-api.mjs har redan unionen (patchActivitiesKindValues) så
// bootstrap-instanser är opåverkade.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration — 1700000049 redigeras inte.

const WORKSHOP_KINDS = ['workshop_assignment', 'workshop_run'];

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (!kindField) return;
    const current = Array.isArray(kindField.values) ? Array.from(kindField.values) : [];
    const missing = WORKSHOP_KINDS.filter((v) => !current.includes(v));
    if (missing.length === 0) return;
    kindField.values = [...current, ...missing];
    app.save(acts);
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (!kindField || !Array.isArray(kindField.values)) return;
    kindField.values = kindField.values.filter((v) => !WORKSHOP_KINDS.includes(v));
    app.save(acts);
  }
);
