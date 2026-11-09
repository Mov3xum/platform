/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 21.8 / § 10.4 (SOC 2 availability) — index för skalning
// (skalbarhetsgranskning 2026-10-08).
//
// De största, snabbast växande kollektionerna filtreras på tenant/aktör och
// sorteras på `created` på varje sidladdning (Bolagsnytt, /aktivitet,
// AI-analys, månadstaket § 9.6 som körs vid VARJE agent-loop, den personliga
// feeden § 32, inflödets lead-lista). Utan sammansatta index blir varje sådan
// fråga en full tabellskanning som växer linjärt med datamängden.
//
// Bara index — inga fält, inga regler, ingen data. Ett index läggs bara till
// när alla dess kolumner finns (migration-only-familjer eller autodate-fält
// som saknas hoppas över i stället för att fälla migrationen). Idempotent.

const INDEXES = {
  activities: [['idx_activities_tenant_created', ['tenant', 'created']]],
  ai_usage_events: [['idx_ai_usage_tenant_created', ['tenant', 'created']]],
  tool_runs: [
    ['idx_tool_runs_tenant_created', ['tenant', 'created']],
    ['idx_tool_runs_triggered_created', ['triggered_by', 'created']]
  ],
  compass_leads: [['idx_compass_leads_tenant_created', ['tenant', 'created']]],
  agent_actions: [
    ['idx_agent_actions_tenant_created', ['tenant', 'created']],
    ['idx_agent_actions_actor_created', ['actor', 'created']]
  ],
  notifications: [['idx_notifications_user_created', ['user', 'created']]],
  tasks: [['idx_tasks_tenant_owner_status', ['tenant', 'owner', 'status']]]
};

migrate(
  (app) => {
    for (const [name, defs] of Object.entries(INDEXES)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      const indexes = Array.isArray(col.indexes) ? [...col.indexes] : [];
      let changed = false;
      for (const [idxName, columns] of defs) {
        if (indexes.some((i) => String(i).includes(idxName))) continue;
        if (!columns.every((c) => col.fields.getByName(c))) continue;
        indexes.push(`CREATE INDEX ${idxName} ON ${name} (${columns.join(', ')})`);
        changed = true;
      }
      if (changed) {
        col.indexes = indexes;
        app.save(col);
      }
    }
  },
  (app) => {
    for (const [name, defs] of Object.entries(INDEXES)) {
      let col;
      try {
        col = app.findCollectionByNameOrId(name);
      } catch {
        continue;
      }
      const names = defs.map(([n]) => n);
      col.indexes = (Array.isArray(col.indexes) ? col.indexes : []).filter(
        (i) => !names.some((n) => String(i).includes(n))
      );
      app.save(col);
    }
  }
);
