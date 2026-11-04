/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — STARTSIDA i en publik modul + bort med den seedade
// eyebrow-texten "STARTUPKOMPASSEN" (CLAUDE.md § 23.11).
//
// 1) `start_page_title`/`start_page_body` på `compass_modules`: en första
//    sida INUTI flödet (före första frågan/chatten) där personalen beskriver
//    vad modulen är till för och vad Movexum vill ha ut av svaren, så att
//    idébäraren läser och förstår syftet innan hen börjar svara. Tom text ⇒
//    ingen startsida (exakt som förut) — en instans utan migrationen ändrar
//    aldrig beteendet. Ren marknads-/instruktionstext utan PII.
//
// 2) Migration 1700000108 seedade startmodulerna med hero_eyebrow =
//    'STARTUPKOMPASSEN', och den publika sidan föll dessutom tillbaka på
//    samma ord när fältet var tomt — så ordet gick inte att få bort från
//    idébeskrivningsmodulen i admin. Den seedade texten nollställs här
//    (BARA när värdet är exakt det seedade ordet; en egen eyebrow lämnas
//    orörd) och appen visar ingen eyebrow alls när fältet är tomt.
//
// compass-familjen är migration-only (§ 23.4) men `compass_modules` inline-
// def i scripts/setup-via-api.mjs speglar fälten (§ 23.7-precedensen).
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32).

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    let changed = false;
    if (!modules.fields.getByName('start_page_title')) {
      modules.fields.add(new Field({ name: 'start_page_title', type: 'text', required: false, max: 200 }));
      changed = true;
    }
    if (!modules.fields.getByName('start_page_body')) {
      modules.fields.add(new Field({ name: 'start_page_body', type: 'text', required: false, max: 6000 }));
      changed = true;
    }
    if (changed) app.save(modules);

    // Nollställ den seedade eyebrow-texten. Idempotent: rör bara rader vars
    // värde är exakt det seedade ordet (skiftlägesokänsligt).
    try {
      const rows = app.findRecordsByFilter('compass_modules', "hero_eyebrow != ''", '', 0, 0);
      for (const r of rows) {
        const eyebrow = String(r.getString('hero_eyebrow') || '').trim().toLowerCase();
        if (eyebrow === 'startupkompassen') {
          r.set('hero_eyebrow', '');
          app.save(r);
        }
      }
    } catch (e) {
      // inga moduler ännu — inget att nollställa
    }
  },
  (app) => {
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      for (const name of ['start_page_title', 'start_page_body']) {
        const f = modules.fields.getByName(name);
        if (f) modules.fields.removeById(f.id);
      }
      app.save(modules);
    } catch (e) {
      // ignore
    }
    // Den nollställda eyebrow-texten återställs inte (ren presentation).
  }
);
