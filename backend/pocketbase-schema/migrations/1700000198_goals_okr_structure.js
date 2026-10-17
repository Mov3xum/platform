/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 42.5 — Verksamhetsplanens OKR-struktur (Key Results 2026).
//
//   goals:
//     • focus_area += 'projekt'  ← mål vars Objective är ett projekt (Sprint-X,
//                                  EOI, GSAI) i stället för ett fokusområde
//     • level                    ← Key result-nivå (MÅSTE spegla GOAL_LEVELS i
//                                  packages/shared/src/goals.ts). Tomt = ej angiven
//     • parent_goal              ← överliggande mål i samma år (self-relation,
//                                  ingen cascade: raderas föräldern nollställs bara
//                                  kopplingen). Cirklar stoppas i skrivlagret.
//     • responsible              ← ansvarig medarbetare (informativ — ger ingen
//                                  rätt att ändra målet; update-regeln är oförändrad)
//     • subteam                  ← delteam/projekt under owner_team ("Sprint-X 2 –
//                                  Kapital", "EOI") — fri text, max 80
//
//   goal_indicators:
//     • target_text              ← målvärdet i ord när det inte är ett rent tal
//                                  ("Över 40%", "TBD", "Ökning med 12 st i BC …")
//
//   goal_status_entries:
//     • status += 'risk'         ← målet riskerar att inte nås (värre än försenad)
//
// Select-värden UNIONAS (befintliga rader blir aldrig ogiltiga). Ingen PII:
// nivå, delteam och målvärde är verksamhetsdata; `responsible` är en intern
// användarrelation (visas som visningsnamn, aldrig e-post, når aldrig AI-
// kontexten). Ingen AI-inferens (riskklass n/a). Fail-soft om målstyrningen
// (1700000159) saknas. Speglas i scripts/setup-via-api.mjs och asserteras i
// verify-baseline.mjs. Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const LEVELS = ['organisation', 'team', 'project', 'project_indicator', 'personal'];

function unionSelect(col, fieldName, value) {
  const field = col.fields.getByName(fieldName);
  if (!field) return false;
  const values = Array.from(field.values || []);
  if (values.includes(value)) return false;
  field.values = [...values, value];
  return true;
}

migrate(
  (app) => {
    let goals;
    try {
      goals = app.findCollectionByNameOrId('goals');
    } catch (e) {
      return;
    }
    const usersCol = app.findCollectionByNameOrId('users');
    unionSelect(goals, 'focus_area', 'projekt');
    const add = (col, f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add(goals, { name: 'level', type: 'select', required: false, maxSelect: 1, values: LEVELS });
    add(goals, {
      name: 'parent_goal',
      type: 'relation',
      required: false,
      collectionId: goals.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    add(goals, {
      name: 'responsible',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    add(goals, { name: 'subteam', type: 'text', required: false, max: 80 });
    const indexes = Array.from(goals.indexes || []);
    if (!indexes.some((i) => String(i).includes('idx_goals_parent_goal'))) {
      goals.indexes = [...indexes, 'CREATE INDEX idx_goals_parent_goal ON goals (parent_goal)'];
    }
    app.save(goals);

    // Backfill: personliga mål har nivån Personligt mål.
    for (const row of app.findAllRecords('goals')) {
      if (String(row.get('level') || '')) continue;
      if (String(row.get('kind') || '') !== 'personal') continue;
      row.set('level', 'personal');
      app.save(row);
    }

    const indicators = app.findCollectionByNameOrId('goal_indicators');
    add(indicators, { name: 'target_text', type: 'text', required: false, max: 200 });
    app.save(indicators);

    const entries = app.findCollectionByNameOrId('goal_status_entries');
    if (unionSelect(entries, 'status', 'risk')) app.save(entries);
  },
  (app) => {
    try {
      const goals = app.findCollectionByNameOrId('goals');
      for (const name of ['level', 'parent_goal', 'responsible', 'subteam']) {
        const f = goals.fields.getByName(name);
        if (f) goals.fields.removeById(f.id);
      }
      goals.indexes = Array.from(goals.indexes || []).filter((i) => !String(i).includes('idx_goals_parent_goal'));
      app.save(goals);
      const indicators = app.findCollectionByNameOrId('goal_indicators');
      const t = indicators.fields.getByName('target_text');
      if (t) {
        indicators.fields.removeById(t.id);
        app.save(indicators);
      }
    } catch (e) {
      /* ignore — select-värden lämnas (ta aldrig bort värden som rader kan bära) */
    }
  }
);
