/// <reference path="../pb_data/types.d.ts" />

// Utökar `tools` med valfri `verify_rubric` (Fas 3, kvalitetsverifiering).
// När fältet är satt kör verktygets autonoma körningar en grader-pass: ett
// separat Mistral-anrop poängsätter svaret mot rubriken och, om kriterier
// saknas, får agenten revidera (upp till en gång). Detta är run-nivå
// "continuous improvement" och motsvarar managed-agents "outcomes", men
// EU-suveränt.
//
// Compliance: människa-i-loopen bevaras — grader-passet auto-publicerar
// inte, det höjer bara kvaliteten på utkastet som en människa sedan
// granskar (CLAUDE.md § 10; EU AI Act art. 72 post-market monitoring).
// Tom rubrik = ingen verifiering (default, oförändrat beteende).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');
    collection.fields.add(
      new Field({
        name: 'verify_rubric',
        type: 'text',
        required: false,
        max: 4000
      })
    );
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tools');
    const field = collection.fields.getByName('verify_rubric');
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
