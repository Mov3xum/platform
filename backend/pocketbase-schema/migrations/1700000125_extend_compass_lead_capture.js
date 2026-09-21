/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — lead-fångst per modul + AI-sammanställning + kontaktpreferens
// (CLAUDE.md § 23.6).
//
//   compass_modules:
//     • create_lead (bool) — steg 4-valet "Skapa lead i Startupkompassen när
//       modulen slutförs". Backfillas till TRUE på alla befintliga moduler så
//       dagens beteende bevaras; intag-routarna tolkar dessutom SAKNAT fält
//       som true (en oapplicerad migration ändrar aldrig beteendet).
//
//   compass_leads:
//     • ai_summary (text) — AI-genererad sammanställning av det besökaren
//       skickade in (mistral-small, best-effort — blockerar aldrig leadet).
//     • contact_preference (select) — besökarens eget val: bli kontaktad av
//       Movexum (contact_me) eller höra av sig själv när hen är redo
//       (self_reach).
//
// GDPR § 5: ai_summary byggs ENBART av det besökaren själv skickade in och
// personnummer-saneras före både AI-anropet och lagringen. contact_preference
// är icke-känslig preferensdata. compass-familjen är migration-only
// (CLAUDE.md § 23.4) — speglas inte i scripts/setup-via-api.mjs.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    // 1. compass_modules.create_lead + backfill till true (dagens beteende).
    const modules = app.findCollectionByNameOrId('compass_modules');
    if (!modules.fields.getByName('create_lead')) {
      modules.fields.add(new Field({ name: 'create_lead', type: 'bool', required: false }));
      app.save(modules);
    }
    try {
      const rows = app.findRecordsByFilter('compass_modules', "id != ''", '', 0, 0);
      for (const r of rows) {
        if (!r.getBool('create_lead')) {
          r.set('create_lead', true);
          app.save(r);
        }
      }
    } catch (e) {
      // inga moduler ännu — inget att backfilla
    }

    // 2. compass_leads.ai_summary + contact_preference.
    const leads = app.findCollectionByNameOrId('compass_leads');
    let changed = false;
    if (!leads.fields.getByName('ai_summary')) {
      leads.fields.add(
        new Field({ name: 'ai_summary', type: 'text', required: false, max: 6000 })
      );
      changed = true;
    }
    if (!leads.fields.getByName('contact_preference')) {
      leads.fields.add(
        new Field({
          name: 'contact_preference',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['contact_me', 'self_reach']
        })
      );
      changed = true;
    }
    if (changed) app.save(leads);
  },
  (app) => {
    // Down: ta bort fälten (collections + data bevaras).
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('create_lead');
      if (fld) {
        modules.fields.remove(fld.id);
        app.save(modules);
      }
    } catch (e) {
      // ignore
    }
    try {
      const leads = app.findCollectionByNameOrId('compass_leads');
      for (const name of ['ai_summary', 'contact_preference']) {
        const fld = leads.fields.getByName(name);
        if (fld) leads.fields.remove(fld.id);
      }
      app.save(leads);
    } catch (e) {
      // ignore
    }
  }
);
