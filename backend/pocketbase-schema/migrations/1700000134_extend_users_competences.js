/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29 — Kompetensmodell för tvärfunktionella team (omorg 2026-11).
//
//   users.competences ← fast taxonomi (packages/shared/src/competences.ts),
//                        multi-select. Vad en Movexum-resurs är bra på.
//   users.title       ← fri yrkesroll/titel (t.ex. "Affärscoach", "CFO").
//   users.bio         ← kort beskrivning av bakgrund/specialitet.
//
// GDPR: detta är personalens YRKESkompetens (berättigat intresse: bemanning av
// tvärfunktionella team), INTE art. 9 särskild kategori. Fälten sätts av
// användaren själv (updateRule = "@request.auth.id = id" oförändrad). De
// whitelistas ALDRIG i den kurerade lib/ai/context.ts; matchnings-AI:n läser
// dem via en egen, isolerad körning (människa-i-loopen) — inte query_collection.
//
// Select-värdena MÅSTE spegla CompetenceId i packages/shared/src/competences.ts.

const COMPETENCE_VALUES = [
  'affarscoaching',
  'affarsutveckling',
  'projektledning',
  'kommunikation',
  'hr_personal',
  'juridik',
  'finansiering_kapital',
  'ai_teknik',
  'hallbarhet',
  'internationalisering',
  'boost_chamber',
  'design',
  'branschspecifik',
  'annat'
];

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    if (!users.fields.getByName('competences')) {
      users.fields.add(
        new Field({
          name: 'competences',
          type: 'select',
          required: false,
          maxSelect: COMPETENCE_VALUES.length,
          values: COMPETENCE_VALUES
        })
      );
    }

    if (!users.fields.getByName('title')) {
      users.fields.add(
        new Field({ name: 'title', type: 'text', required: false, max: 120 })
      );
    }

    if (!users.fields.getByName('bio')) {
      users.fields.add(
        new Field({ name: 'bio', type: 'text', required: false, max: 1000 })
      );
    }

    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    ['competences', 'title', 'bio'].forEach((name) => {
      const f = users.fields.getByName(name);
      if (f) users.fields.remove(f);
    });
    return app.save(users);
  }
);
