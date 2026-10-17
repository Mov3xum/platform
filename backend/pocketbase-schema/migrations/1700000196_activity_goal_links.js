/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 53.4 — mål som drivs av aktiviteter.
//
//   goal_indicators:
//     • source += 'activities'  ← värdet räknas live ur kopplade aktiviteter
//     • activity_measure        ← vad som mäts (MÅSTE spegla ACTIVITY_MEASURES i
//                                 packages/shared/src/goal-activities.ts)
//
//   annual_wheel_items + incubator_events (samma fyra fält):
//     • goal_indicators       ← indikatorer aktiviteten bidrar till
//                               (relation → goal_indicators, multi, ingen cascade:
//                               en raderad indikator nollställs bara i listan)
//     • planned_participants  ← planerat antal deltagare (0 = ingen plan)
//     • completed_at          ← när aktiviteten markerades genomförd/inställd
//     • outcome_verdict       ← on_plan | below_plan | cancelled (MÅSTE spegla
//                               ACTIVITY_OUTCOMES). Tomt = inte genomförd än.
//
// Kopplingen tenant-verifieras i skrivlagret (lib/core/write/activity-goals.ts);
// relationsfälten i sig är inte tenant-scope:ade. Ingen PII (verksamhetsdata,
// tal), ingen AI-inferens (riskklass n/a). Collection-id:n slås upp på NAMN
// (§ 30.4 p. 1). Speglas i scripts/setup-via-api.mjs och asserteras i
// verify-baseline.mjs. Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const MEASURES = ['completed', 'completed_on_plan', 'participants', 'eval_score', 'eval_nps'];
const OUTCOMES = ['on_plan', 'below_plan', 'cancelled'];
const ACTIVITY_FIELDS = ['goal_indicators', 'planned_participants', 'completed_at', 'outcome_verdict'];

migrate(
  (app) => {
    const indicators = app.findCollectionByNameOrId('goal_indicators');
    const source = indicators.fields.getByName('source');
    if (source) {
      const values = Array.from(source.values || []);
      if (!values.includes('activities')) {
        source.values = [...values, 'activities'];
      }
    }
    if (!indicators.fields.getByName('activity_measure')) {
      indicators.fields.add(
        new Field({ name: 'activity_measure', type: 'select', required: false, maxSelect: 1, values: MEASURES })
      );
    }
    app.save(indicators);

    for (const name of ['annual_wheel_items', 'incubator_events']) {
      const col = app.findCollectionByNameOrId(name);
      const add = (f) => {
        if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
      };
      add({
        name: 'goal_indicators',
        type: 'relation',
        required: false,
        collectionId: indicators.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 20
      });
      add({ name: 'planned_participants', type: 'number', required: false, onlyInt: true, min: 0, max: 100000 });
      add({ name: 'completed_at', type: 'date', required: false });
      add({ name: 'outcome_verdict', type: 'select', required: false, maxSelect: 1, values: OUTCOMES });
      app.save(col);
    }
  },
  (app) => {
    for (const name of ['annual_wheel_items', 'incubator_events']) {
      try {
        const col = app.findCollectionByNameOrId(name);
        for (const n of ACTIVITY_FIELDS) {
          const f = col.fields.getByName(n);
          if (f) col.fields.removeById(f.id);
        }
        app.save(col);
      } catch (e) {
        // ignore
      }
    }
    try {
      const indicators = app.findCollectionByNameOrId('goal_indicators');
      const f = indicators.fields.getByName('activity_measure');
      if (f) indicators.fields.removeById(f.id);
      app.save(indicators);
    } catch (e) {
      // ignore
    }
  }
);
