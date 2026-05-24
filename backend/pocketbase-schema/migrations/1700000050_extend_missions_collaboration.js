/// <reference path="../pb_data/types.d.ts" />

// Utökar `missions` med samarbetsfält: flera bolag, deltagare med roller,
// projekt-typ och synlighetskontroll. Bakåtkompatibelt — befintliga rader
// (med single `startup`, `recipients[]`, etc.) fortsätter fungera. Server
// actions skriver fortsatt `startup = startups[0]` och `recipients =
// participants.filter(role!=='observer')` så queries som inte vet om
// nya fält ändå hittar rätt.
//
// RBAC görs i applikationslagret (jfr 1700000049_drop_role_checks).

migrate(
  (app) => {
    const missions = app.findCollectionByNameOrId('missions');

    // ── type: lägg till 'project' ──────────────────────────
    const typeField = missions.fields.getByName('type');
    if (typeField && !typeField.values.includes('project')) {
      typeField.values = [
        'workshop',
        'sprint_x',
        'community',
        'report',
        'onboarding',
        'custom',
        'project'
      ];
    }

    // ── startups: multi-relation till startups_collection ──
    if (!missions.fields.getByName('startups')) {
      missions.fields.add(
        new Field({
          name: 'startups',
          type: 'relation',
          required: false,
          collectionId: 'startups_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 50
        })
      );
    }

    // ── participants_json: [{ user_id, role, added_at, added_by }]
    if (!missions.fields.getByName('participants_json')) {
      missions.fields.add(
        new Field({
          name: 'participants_json',
          type: 'json',
          required: false,
          maxSize: 50000
        })
      );
    }

    // ── visibility: 'tenant' (default) | 'participants' ────
    if (!missions.fields.getByName('visibility')) {
      missions.fields.add(
        new Field({
          name: 'visibility',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['tenant', 'participants']
        })
      );
    }

    app.save(missions);

    const db = app.db();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_missions_visibility ON missions (visibility)'
    ).execute();
  },
  (app) => {
    const missions = app.findCollectionByNameOrId('missions');

    ['startups', 'participants_json', 'visibility'].forEach((name) => {
      const f = missions.fields.getByName(name);
      if (f) missions.fields.remove(f);
    });

    const typeField = missions.fields.getByName('type');
    if (typeField) {
      typeField.values = [
        'workshop',
        'sprint_x',
        'community',
        'report',
        'onboarding',
        'custom'
      ];
    }

    app.save(missions);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_missions_visibility').execute();
  }
);
