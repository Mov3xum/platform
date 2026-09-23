/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — MALLAR för den publika modulsidan (CLAUDE.md § 23.7).
//
// Lägger `layout` (select, ett värde) på `compass_modules`. Mallen styr hela
// kompositionen på /m/<public_slug>: bild till vänster/höger, heltäckande
// omslag, färgpanel, klassisk banner eller minimal typografi. Värdena MÅSTE
// spegla `COMPASS_LAYOUTS` i packages/shared/src/compass-layout.ts (källan
// av sanning för etiketter + normalisering).
//
// Saknat/tomt värde tolkas som `classic` (exakt som sidan såg ut före
// mallarna) — appen normaliserar via `normalizeCompassLayout`, så en instans
// utan den här migrationen ändrar aldrig utseendet på befintliga moduler.
//
// Ren presentation: ingen PII, ingen AI-inferens, ingen ny dataväg.
// compass-familjen är migration-only (CLAUDE.md § 23.4) — speglas därför inte
// i scripts/setup-via-api.mjs. Nytt, oföränderligt filnummer (§ 10.3 A.8.32).

const LAYOUT_VALUES = ['classic', 'split_left', 'split_right', 'cover', 'panel', 'minimal'];

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    if (!modules.fields.getByName('layout')) {
      modules.fields.add(
        new Field({
          name: 'layout',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: LAYOUT_VALUES
        })
      );
      app.save(modules);
    }
  },
  (app) => {
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('layout');
      if (fld) modules.fields.removeById(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
