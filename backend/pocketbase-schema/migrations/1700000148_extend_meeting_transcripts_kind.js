/// <reference path="../pb_data/types.d.ts" />

// Mötesläge (CLAUDE.md § 34) — mötestyp. Ett möte kan gälla ett BOLAG
// (`startup`, som förut), vara INTERNT (Movexum-internt: ledningsgrupp,
// styrelse, team …) eller EXTERNT (partner, kommun, investerare, annan part
// som inte är ett bolag i portföljen). För internt/externt anger coachen
// själv i fritext vem/vad mötet gäller (`counterpart`, ≤ 200 tecken) — det är
// en verksamhetsetikett (organisation/forum), ingen personuppgift avsedd;
// UI:t uppmanar att inte skriva personnamn (GDPR § 5).
//
// Sparmål: bolagsmöten → anteckning på bolagskortet (som förut); interna/
// externa möten → Markdown-fil i coachens personliga Filer (`user_files`,
// strikt ägaren-bara, § 17.2). Saknas fälten (omigrerad instans) tolkar
// appen mötet som bolagsmöte. Nytt, oföränderligt filnummer (§ 10.3 A.8.32).
// Owner-only-kollektion ⇒ migration-only (samma precedens som 1700000142).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('meeting_transcripts');
    let changed = false;
    if (!collection.fields.getByName('kind')) {
      collection.fields.add(
        new Field({
          name: 'kind',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['startup', 'internal', 'external']
        })
      );
      changed = true;
    }
    if (!collection.fields.getByName('counterpart')) {
      collection.fields.add(new Field({ name: 'counterpart', type: 'text', required: false, max: 200 }));
      changed = true;
    }
    if (changed) app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('meeting_transcripts');
      for (const name of ['kind', 'counterpart']) {
        const field = collection.fields.getByName(name);
        if (field) collection.fields.removeById(field.id);
      }
      app.save(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
