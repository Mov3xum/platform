/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 9.9 — modellregistret uppgraderat 2026-11-26.
//
// Mistral har avvecklat Mistral Medium 3.5 (`mistral-medium-latest`,
// avvecklad 2026-10-31, stängs 2027-04-30) och ersatt den med Mistral Large 4.
// Appen kör redan ett sparat `mistral-medium-latest` som Large 4
// (`normalizeModelId` i apps/web/src/lib/ai/models.ts), men valet i
// formulären (verktyg, intag-moduler) ska visa det som faktiskt körs.
//
// Datamigration: skriver om `tools.model` och `compass_modules.model` från
// det avvecklade id:t till `mistral-large-latest`. Select-fältens värdelistor
// rörs INTE (det gamla värdet ligger kvar som giltigt så att en äldre
// app-version eller en post som skapas under utrullningen inte avvisas).
// `tool_versions` (oföränderliga snapshots) och `tool_runs` (historik) rörs
// inte — de visar vilken modell som gällde då. Idempotent. Ingen personuppgift.

const REPLACEMENTS = [
  { collection: 'tools', from: 'mistral-medium-latest', to: 'mistral-large-latest' },
  { collection: 'compass_modules', from: 'mistral-medium-latest', to: 'mistral-large-latest' }
];

migrate(
  (app) => {
    for (const r of REPLACEMENTS) {
      try {
        app
          .db()
          .newQuery(`UPDATE ${r.collection} SET model = '${r.to}' WHERE model = '${r.from}'`)
          .execute();
      } catch (e) {
        // Fail-soft: en instans utan kollektionen/fältet ska inte blockera
        // övriga migrationer. Appen normaliserar id:t vid körning ändå.
      }
    }
  },
  () => {
    // Ingen nedgradering: det går inte att veta vilka poster som bar det
    // gamla id:t, och den avvecklade modellen ska inte väljas igen.
  }
);
