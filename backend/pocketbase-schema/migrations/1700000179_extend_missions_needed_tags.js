/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29.7 (steg 2–3) — Meriter ur avslutade team + inaktuella
// kompetensprofiler.
//
//   missions.needed_tags          ← json: [slug, …] — vilka hashtags teamet
//                                   sattes ihop för (från AI-teamförslaget i
//                                   Nytt team). Ett AVSLUTAT uppdrag vars
//                                   behov överlappar ett nytt behov ger
//                                   deltagarna meritpoäng i rankningen
//                                   (computeTeamMerits, lätt vikt). Räknas
//                                   live, lagras aldrig per person.
//   users.competence_updated_at   ← date: när kompetensprofilen (hashtags/
//                                   nivåer) senast sparades. Driver
//                                   "inaktuell profil"-påminnelsen (> 180
//                                   dagar) på Min profil och i Inställningar
//                                   → Kompetenser. Självservice-fält
//                                   (fältlåset 1700000174 omfattar det inte).
//
// GDPR: `needed_tags` är verksamhetsdata om uppdraget (inga personer);
// tidsstämpeln är metadata om personens eget profilfält. Ingen ny PII,
// ingen ny AI-dataväg (`users`/`missions` läses av matcharen som förut).
// Riskklass oförändrad (DPIA docs/privacy/dpia-team-matching.md, § 5).
// Speglas i setup-via-api.mjs, asserteras i verify-baseline.mjs.

migrate(
  (app) => {
    const missions = app.findCollectionByNameOrId('missions');
    if (!missions.fields.getByName('needed_tags')) {
      missions.fields.add(
        new Field({ name: 'needed_tags', type: 'json', required: false, maxSize: 2000 })
      );
      app.save(missions);
    }

    const users = app.findCollectionByNameOrId('users');
    if (!users.fields.getByName('competence_updated_at')) {
      users.fields.add(new Field({ name: 'competence_updated_at', type: 'date', required: false }));
      app.save(users);
    }
  },
  (app) => {
    const missions = app.findCollectionByNameOrId('missions');
    const f = missions.fields.getByName('needed_tags');
    if (f) {
      missions.fields.remove(f);
      app.save(missions);
    }
    const users = app.findCollectionByNameOrId('users');
    const g = users.fields.getByName('competence_updated_at');
    if (g) {
      users.fields.remove(g);
      app.save(users);
    }
  }
);
