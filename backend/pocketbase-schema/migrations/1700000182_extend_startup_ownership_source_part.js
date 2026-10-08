/// <reference path="../pb_data/types.d.ts" />

// Valbara datadelar vid bolagsregister-hämtning (CLAUDE.md § 11.8).
//
// Personalen kan nu välja exakt vilka delar som hämtas från Roaring (grunddata,
// bokslut, koncernstruktur, verklig huvudman). Koncernstruktur och verklig
// huvudman skrivs båda till `startup_ownership` med `source = roaring`, och
// ägarbilden ersätts per källa. Utan att veta vilket API en rad kom från
// skulle en hämtning av BARA koncernstruktur radera raderna från verklig
// huvudman. `source_part` bär därför vilken del raden kom från, och writern
// ersätter bara den del som faktiskt hämtades.
//
// Fältet är text (inte select) så en ny provider med ägardata kan lägga till
// en del utan migration; värdet valideras i koden mot providerns deklarerade
// delar (`company-registry/parts.ts`). Ingen PII — ett tekniskt delnamn.
//
// Backfill av befintliga Roaring-rader: verklig huvudman är den enda delen
// som sätter kontrollgrund eller procentintervall (`control_basis`,
// `pct_max`); koncernstrukturens rader har aldrig dem. En huvudmansrad helt
// utan andel och kontrollgrund kan inte skiljas från en anonym koncernrad och
// märks som koncernstruktur — den ersätts då nästa gång koncernstrukturen
// hämtas, och läggs till på nytt av nästa huvudmanshämtning.

const PART_FIELD = 'source_part';

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('startup_ownership');
    if (!collection.fields.getByName(PART_FIELD)) {
      collection.fields.add(
        new Field({
          name: PART_FIELD,
          type: 'text',
          required: false,
          max: 40,
          pattern: '^[a-z_]*$'
        })
      );
      app.save(collection);
    }

    let rows;
    try {
      rows = app.findRecordsByFilter('startup_ownership', 'source = "roaring" && source_part = ""', '', 0, 0);
    } catch (e) {
      return;
    }
    for (const rec of rows) {
      const control = String(rec.get('control_basis') || '');
      const pctMax = Number(rec.get('pct_max') || 0);
      const part = control !== '' || pctMax > 0 ? 'beneficial_owners' : 'group_structure';
      try {
        rec.set(PART_FIELD, part);
        app.save(rec);
      } catch (e) {
        // best-effort per rad — ett fel ska inte stoppa övriga
      }
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('startup_ownership');
    const field = collection.fields.getByName(PART_FIELD);
    if (field) collection.fields.remove(field.id);
    return app.save(collection);
  }
);
