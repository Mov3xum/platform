/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — liten temarubrik ovanför frågan (CLAUDE.md § 23.16,
// 2026-11). `compass_questions.topic` (text ≤ 80, valfri), t.ex.
// "Marknadspotential": visas som en liten rubrik ovanför frågan i formulär,
// quiz och chattens avslutssteg så besökaren förstår vilket tema frågan hör
// till. Tomt ⇒ ingen rubrik (inget ändras för befintliga frågor).
//
// Ingen PII (modulens egna texter). Speglat i setup-via-api.mjs och
// asserterat i verify-baseline.mjs. Oföränderlig migration (§ 10.3 A.8.32).

migrate(
  (app) => {
    const questions = app.findCollectionByNameOrId('compass_questions');
    if (!questions.fields.getByName('topic')) {
      questions.fields.add(new Field({ name: 'topic', type: 'text', required: false, max: 80 }));
      app.save(questions);
    }
  },
  (app) => {
    try {
      const questions = app.findCollectionByNameOrId('compass_questions');
      const f = questions.fields.getByName('topic');
      if (f) {
        questions.fields.removeById(f.id);
        app.save(questions);
      }
    } catch (e) {
      /* ignore */
    }
  }
);
