/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.7 — bakåtlänk från bokföringsspåren till ärendet. När en
// stödcheck beviljas skapar skrivlagret en de minimis-post (om statsstöds-
// grunden är de minimis) och en kapitalrad (`capital_rounds`, typ
// soft_funding). Båda får `support_check_application` så att de minimis-
// listan, kapitalhistoriken och projektsidan alla länkar tillbaka till
// ansökan — beloppen lagras aldrig som kopior utan ansökan är sanningen.
// cascadeDelete: false — raderas ansökan står posterna kvar (statsstöds-
// registret får inte tappa historik); länken nollställs av PB.

migrate(
  (app) => {
    const applications = app.findCollectionByNameOrId('support_check_applications');
    for (const name of ['capital_rounds', 'de_minimis_stod']) {
      const col = app.findCollectionByNameOrId(name);
      if (!col.fields.getByName('support_check_application')) {
        col.fields.add(
          new Field({
            name: 'support_check_application',
            type: 'relation',
            required: false,
            collectionId: applications.id,
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          })
        );
        app.save(col);
      }
    }
  },
  (app) => {
    for (const name of ['capital_rounds', 'de_minimis_stod']) {
      const col = app.findCollectionByNameOrId(name);
      const f = col.fields.getByName('support_check_application');
      if (f) {
        col.fields.remove(f);
        app.save(col);
      }
    }
  }
);
