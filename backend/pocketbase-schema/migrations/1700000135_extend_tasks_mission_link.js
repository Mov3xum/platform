/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29 — Låter en `tasks`-rad länkas till ett uppdrag (mission), så
// att medlemmarna i ett tvärfunktionellt team får en personlig uppgift när
// teamet sätts (samma mönster som assignment-collaboration § 18.4, men mot en
// mission i stället för en startup).
//
//   tasks.link_kind += 'mission' (union — bevarar befintliga värden)
//   tasks.mission   ← relation→missions (cascadeDelete: false; uppgiften
//                      överlever att uppdraget tas bort, som event/contact).
//
// Ingen ny PII-väg: tasks.* är redan exkluderat ur den kurerade AI-kontexten
// (§ 15.3) och tasks.details fältmaskas i query-verktygen (§ 9.3).

const LINK_KINDS = ['mission'];

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const missions = app.findCollectionByNameOrId('missions');

    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind) {
      const current = Array.isArray(linkKind.values) ? Array.from(linkKind.values) : [];
      const missing = LINK_KINDS.filter((v) => !current.includes(v));
      if (missing.length > 0) linkKind.values = [...current, ...missing];
    }

    if (!tasks.fields.getByName('mission')) {
      tasks.fields.add(
        new Field({
          name: 'mission',
          type: 'relation',
          required: false,
          collectionId: missions.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind && Array.isArray(linkKind.values)) {
      linkKind.values = linkKind.values.filter((v) => !LINK_KINDS.includes(v));
    }
    const mission = tasks.fields.getByName('mission');
    if (mission) tasks.fields.remove(mission);
    app.save(tasks);
  }
);
