/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30) — TAGGAR i stället för obligatoriskt spår, samt
// valfri ANSVARIG i organisationen.
//
// 1) `tags` (select, multi, valfri) ersätter `track` (select, single,
//    obligatorisk). Taggarna gör att aktiviteter kan följas upp per tagg och
//    att en aktivitet kan bära flera taggar — eller ingen alls. Befintliga
//    rader backfillas: `tags = [track]`. `track` behålls som deprecerat,
//    icke-obligatoriskt fält (expand/contract) så att ingen data går förlorad
//    om backfillen inte kan skriva en rad; appen läser det inte längre.
// 2) `responsible` (relation → users, valfri, single) låter staff peka ut vem
//    i organisationen som äger aktiviteten. Relationen till en intern
//    användare är ingen ny PII-väg — den whitelistas aldrig i
//    lib/ai/context.ts och `users` är fortsatt denylistad för query_collection
//    (§ 9.3). cascadeDelete=false: en raderad användare nollställer bara
//    ansvarig, aktiviteten lever vidare.
//
// Riskklass minimal: ingen AI-inferens, ingen PII (intern verksamhetsplanering).
// Nytt, oföränderligt filnummer (§ 10.3 A.8.32). Speglas i setup-via-api.mjs.

const TAG_VALUES = [
  'kampanjer',
  'verksamhetsrapporter',
  'projekt',
  'team',
  'ledningsgrupp',
  'projektstyrgrupper',
  'ovrigt'
];

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const collection = app.findCollectionByNameOrId('annual_wheel_items');

    if (!collection.fields.getByName('tags')) {
      collection.fields.add(
        new Field({
          name: 'tags',
          type: 'select',
          required: false,
          maxSelect: TAG_VALUES.length,
          values: TAG_VALUES
        })
      );
    }

    if (!collection.fields.getByName('responsible')) {
      collection.fields.add(
        new Field({
          name: 'responsible',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    // `track` blir valfritt — nya poster skrivs utan det.
    const track = collection.fields.getByName('track');
    if (track) track.required = false;

    app.save(collection);

    // Backfill: befintliga rader får sitt spår som första tagg. Rå SQL i
    // stället för record-API:t → rör inte `updated` och kan inte fällas av
    // validering på en annan (orelaterad) kolumn. Idempotent: skriver bara
    // rader som saknar taggar. `track` är ett enum → ingen injektionsrisk,
    // och WHERE-satsen begränsar ändå till kända värden.
    try {
      const allowed = TAG_VALUES.map((v) => `'${v}'`).join(', ');
      app
        .db()
        .newQuery(
          `UPDATE annual_wheel_items SET tags = '["' || track || '"]' ` +
            `WHERE (tags IS NULL OR tags = '' OR tags = '[]') ` +
            `AND track IN (${allowed})`
        )
        .execute();
    } catch (e) {
      // Fail-soft: en instans utan rader ska inte blockera schema-ändringen.
    }

    return null;
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('annual_wheel_items');
      for (const name of ['tags', 'responsible']) {
        const field = collection.fields.getByName(name);
        if (field) collection.fields.removeById(field.id);
      }
      const track = collection.fields.getByName('track');
      if (track) track.required = true;
      app.save(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
