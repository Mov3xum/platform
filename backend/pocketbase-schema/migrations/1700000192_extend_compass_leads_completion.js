/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — besökarens genomförandestatus per lead (CLAUDE.md § 23.10).
//
//   compass_leads.completion (select): in_progress | completed | abandoned
//     • in_progress — besökaren har börjat (chatt-tur eller första svaret i
//       formulär/quiz) men inte slutfört modulen.
//     • completed   — modulen slutfördes (formuläret skickades in, quiz-
//       resultatet visades, chattens avslutssteg skickades in).
//     • abandoned   — besökaren lämnade innan slutförandet (pagehide-beacon
//       eller lazy-svep över in_progress äldre än ABANDON_AFTER).
//
// Skild från `status` (personalens pipeline: new/contacted/…) — det här är
// VAD BESÖKAREN GJORDE, inte vad personalen gjort. Befintliga leads skapades
// bara vid slutförande → backfillas till `completed`. Appen tolkar SAKNAT
// fält som `completed` (en oapplicerad migration ändrar aldrig beteendet).
//
// GDPR § 5: ingen ny personuppgift — en statusflagga. compass-familjen är
// migration-only (§ 23.4) men `compass_leads` har en inline-def i
// setup-via-api.mjs (regel-sync) som speglar fältet.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    const leads = app.findCollectionByNameOrId('compass_leads');
    let changed = false;
    if (!leads.fields.getByName('completion')) {
      leads.fields.add(
        new Field({
          name: 'completion',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['in_progress', 'completed', 'abandoned']
        })
      );
      changed = true;
    }
    const idx = 'CREATE INDEX idx_compass_leads_tenant_completion ON compass_leads (tenant, completion)';
    if (!leads.indexes.includes(idx)) {
      leads.indexes.push(idx);
      changed = true;
    }
    if (changed) app.save(leads);

    // Backfill: allt som finns skapades vid slutförande.
    try {
      const rows = app.findRecordsByFilter('compass_leads', "completion = ''", '', 0, 0);
      for (const r of rows) {
        r.set('completion', 'completed');
        app.save(r);
      }
    } catch (e) {
      // inga leads ännu — inget att backfilla
    }
  },
  (app) => {
    const leads = app.findCollectionByNameOrId('compass_leads');
    const f = leads.fields.getByName('completion');
    if (f) {
      leads.fields.removeById(f.id);
      leads.indexes = leads.indexes.filter((i) => !i.includes('idx_compass_leads_tenant_completion'));
      app.save(leads);
    }
  }
);
