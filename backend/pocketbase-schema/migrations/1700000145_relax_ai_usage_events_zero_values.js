/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 9.6 / § 28 — kostnadsloggen `ai_usage_events` tappade TYST alla
// händelser med värdet 0 i `tokens_out` eller `cost_estimate_usd`.
//
// Grundorsak: PocketBase behandlar 0 som "tomt" för ett `required`
// nummerfält (validation_required: "Cannot be blank."), och 1700000058
// skapade `tokens_in`/`tokens_out`/`cost_estimate_usd` som required. Följd
// (empiriskt, PB v0.23.4): `logAiUsage` (fail-soft, § 10.4) svalde felet och
// raden skrevs aldrig för
//   - embeddings (`mistral-embed`, tokens_out = 0 → ALL RAG-index/-sök-
//     förbrukning § 26/§ 27 saknades i /insights, /admin/ai-miljo och
//     månadstaket § 9.6),
//   - Voxtral-anrop som gav tom text (tokens_out = 0, § 31/§ 34 — Voxtral
//     debiterar ljudingången, så anropet kostar ändå),
//   - alla anrop där prisregistret saknar modellen (cost_estimate_usd = 0).
//
// Fixen: gör de tre talfälten valfria (min: 0 behålls — negativa värden
// avvisas fortfarande). Appen sätter alltid alla tre explicit, så semantiken
// "saknat = 0" gäller bara defensivt. Idempotent; oföränderlig (§ 10.3).
// Speglas i scripts/setup-via-api.mjs (def + patchCollection) för
// bootstrap-paritet.

const FIELDS = ['tokens_in', 'tokens_out', 'cost_estimate_usd'];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('ai_usage_events');
    let touched = false;
    for (const name of FIELDS) {
      const field = collection.fields.getByName(name);
      if (field && field.required) {
        field.required = false;
        touched = true;
      }
    }
    if (touched) app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('ai_usage_events');
    for (const name of FIELDS) {
      const field = collection.fields.getByName(name);
      if (field) field.required = true;
    }
    app.save(collection);
  }
);
