/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 18.4 — samarbete kring tilldelningar.
//
// Vid tilldelning av en workshop eller ett utbildningsdokument ska staff kunna
// skriva instruktioner, bjuda in andra Movexum-resurser (coacher/mentorer) som
// medarbetare, och knyta tilldelningen till ett möte.
//
//   workshop_assignments:
//     • instructions   ← fritext-instruktion till bolaget (text, max 2000)
//     • collaborators   ← inbjudna Movexum-resurser (relation→users, multi)
//     • meeting         ← kopplat möte (relation→incubator_events)
//
//   education_document_assignments (instructions finns redan):
//     • collaborators   ← inbjudna Movexum-resurser (relation→users, multi)
//     • meeting         ← kopplat möte (relation→incubator_events)
//
// Ingen PII tillkommer i AI-kontexten — `collaborators` är interna användare
// och whitelistas aldrig i lib/ai/context.ts.

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const eventsCol = app.findCollectionByNameOrId('incubator_events');

    const addCollab = (col) => {
      if (!col.fields.getByName('collaborators')) {
        col.fields.add(
          new Field({
            name: 'collaborators',
            type: 'relation',
            required: false,
            collectionId: usersCol.id,
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 20
          })
        );
      }
      if (!col.fields.getByName('meeting')) {
        col.fields.add(
          new Field({
            name: 'meeting',
            type: 'relation',
            required: false,
            collectionId: eventsCol.id,
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          })
        );
      }
    };

    // --- workshop_assignments ---
    const wa = app.findCollectionByNameOrId('workshop_assignments');
    if (!wa.fields.getByName('instructions')) {
      wa.fields.add(
        new Field({ name: 'instructions', type: 'text', required: false, max: 2000 })
      );
    }
    addCollab(wa);
    app.save(wa);

    // --- education_document_assignments ---
    const da = app.findCollectionByNameOrId('education_document_assignments');
    addCollab(da);
    app.save(da);
  },
  (app) => {
    const removeFields = (name, fields) => {
      const col = app.findCollectionByNameOrId(name);
      for (const f of fields) {
        const field = col.fields.getByName(f);
        if (field) col.fields.remove(field);
      }
      app.save(col);
    };
    removeFields('workshop_assignments', ['instructions', 'collaborators', 'meeting']);
    removeFields('education_document_assignments', ['collaborators', 'meeting']);
  }
);
