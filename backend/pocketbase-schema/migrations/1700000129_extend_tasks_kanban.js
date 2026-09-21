/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 15.7 — bolagskanban på bolagskortet (fliken "Aktiviteter").
//
//   tasks.status    += 'backlog' + 'review' (union — ger 6 kanban-kolumner:
//                      backlog | open | in_progress | review | blocked | done;
//                      'cancelled' finns kvar men visas inte på tavlan)
//   tasks.assignees ← Movexum-kollegor på kortet (relation→users, multi).
//
// Union-mönstret från 1700000126: befintliga värden bevaras, inget ersätts.
// `assignees` är interna användare — ingen ny PII-väg: tasks.* är redan
// exkluderat ur den kurerade AI-kontexten (§ 15.3) och `tasks.details`
// fältmaskas i query-verktygen (§ 9.3). Inga regeländringar (updateRule
// tillåter redan staff — kollegorna som tilldelas är alltid staff).

const KANBAN_STATUSES = ['backlog', 'review'];

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const usersCol = app.findCollectionByNameOrId('users');

    const statusField = tasks.fields.getByName('status');
    if (statusField) {
      const current = Array.isArray(statusField.values)
        ? Array.from(statusField.values)
        : [];
      const missing = KANBAN_STATUSES.filter((v) => !current.includes(v));
      if (missing.length > 0) statusField.values = [...current, ...missing];
    }

    if (!tasks.fields.getByName('assignees')) {
      tasks.fields.add(
        new Field({
          name: 'assignees',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 20
        })
      );
    }

    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const statusField = tasks.fields.getByName('status');
    if (statusField && Array.isArray(statusField.values)) {
      statusField.values = statusField.values.filter(
        (v) => !KANBAN_STATUSES.includes(v)
      );
    }
    const assignees = tasks.fields.getByName('assignees');
    if (assignees) tasks.fields.remove(assignees);
    app.save(tasks);
  }
);
