/// <reference path="../pb_data/types.d.ts" />

// Extends tool_runs with assignment-flow fields (assigned_to/by, deadline,
// instruction, knowledge_sources, thread), adds parent_run+version for
// versioning, and expands the status enum with assignment lifecycle values.
//
// Also extends activities.kind enum with new lifecycle kinds for the
// "Den röda tråden"-log (assignment, approval, meeting, milestone, irl,
// phase, kompass, note, onboarding, chat).

migrate(
  (app) => {
    const tr = app.findCollectionByNameOrId('tool_runs');
    const users = app.findCollectionByNameOrId('users');

    // ── Assignment fields ──────────────────────────────────
    tr.fields.add(
      new Field({
        name: 'assigned_to',
        type: 'relation',
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      })
    );
    tr.fields.add(
      new Field({
        name: 'assigned_by',
        type: 'relation',
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      })
    );
    tr.fields.add(
      new Field({
        name: 'deadline',
        type: 'date',
        required: false
      })
    );
    tr.fields.add(
      new Field({
        name: 'instruction',
        type: 'editor',
        required: false
      })
    );
    tr.fields.add(
      new Field({
        name: 'knowledge_sources',
        type: 'json',
        required: false
      })
    );
    tr.fields.add(
      new Field({
        name: 'thread',
        type: 'json',
        required: false
      })
    );

    // ── Versioning ────────────────────────────────────────
    tr.fields.add(
      new Field({
        name: 'parent_run',
        type: 'relation',
        required: false,
        collectionId: tr.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      })
    );
    tr.fields.add(
      new Field({
        name: 'version',
        type: 'number',
        required: false,
        min: 1
      })
    );

    // ── Status enum: utöka med assignment lifecycle ─────────
    const statusField = tr.fields.getByName('status');
    if (statusField) {
      statusField.values = [
        'queued',
        'running',
        'succeeded',
        'failed',
        'assigned',
        'in_progress',
        'ready_for_review',
        'approved',
        'rejected'
      ];
    }

    app.save(tr);

    // Backfill version=1 for all existing runs
    const db = app.db();
    db.newQuery('UPDATE tool_runs SET version = 1 WHERE version IS NULL OR version = 0').execute();

    // Indexes
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_tool_runs_assigned_to ON tool_runs (assigned_to)'
    ).execute();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_tool_runs_parent_run ON tool_runs (parent_run)'
    ).execute();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_tool_runs_status ON tool_runs (status)'
    ).execute();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_tool_runs_deadline ON tool_runs (deadline)'
    ).execute();

    // ── activities.kind enum: utöka för Logg-tabben ──────────
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      kindField.values = [
        'manual',
        'tool_run',
        'assignment',
        'approval',
        'meeting',
        'milestone',
        'irl',
        'phase',
        'kompass',
        'note',
        'onboarding',
        'chat'
      ];
      app.save(acts);
    }
  },
  (app) => {
    // Down migration: drop added fields, revert enums
    const tr = app.findCollectionByNameOrId('tool_runs');
    [
      'assigned_to',
      'assigned_by',
      'deadline',
      'instruction',
      'knowledge_sources',
      'thread',
      'parent_run',
      'version'
    ].forEach((name) => {
      const f = tr.fields.getByName(name);
      if (f) tr.fields.remove(f);
    });

    const statusField = tr.fields.getByName('status');
    if (statusField) {
      statusField.values = ['queued', 'running', 'succeeded', 'failed'];
    }
    app.save(tr);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_tool_runs_assigned_to').execute();
    db.newQuery('DROP INDEX IF EXISTS idx_tool_runs_parent_run').execute();
    db.newQuery('DROP INDEX IF EXISTS idx_tool_runs_status').execute();
    db.newQuery('DROP INDEX IF EXISTS idx_tool_runs_deadline').execute();

    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      kindField.values = ['manual', 'tool_run'];
      app.save(acts);
    }
  }
);
