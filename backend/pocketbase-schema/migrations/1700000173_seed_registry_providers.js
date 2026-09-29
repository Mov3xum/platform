/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 11.8 — upsertar två bolagsregister-providers i
// integration_providers-katalogen (kategorin 'company_registry' finns sedan
// 1700000060):
//
//   roaring       Roaring (SE/EU) — grunddata, årsredovisningsposter
//                 (inkl. balansomslutning), koncernstruktur och verklig
//                 huvudman. Handler: lib/integrations/providers/roaring/.
//   bolagsverket  Bolagsverket "Värdefulla datamängder" (SE, primärkälla,
//                 kostnadsfritt API) — grunddata: namn, bolagsform,
//                 registreringsdatum, SNI, status, säte.
//                 Handler: lib/integrations/providers/bolagsverket/.
//
// Idempotent (upsert på slug). Allabolag-stubben (1700000060) lämnas orörd.

migrate(
  (app) => {
    const providers = app.findCollectionByNameOrId('integration_providers');

    const categoryField = providers.fields.getByName('category');
    if (categoryField && !categoryField.values.includes('company_registry')) {
      categoryField.values = [...categoryField.values, 'company_registry'];
      app.save(providers);
    }

    const rows = [
      {
        slug: 'roaring',
        name: 'Roaring',
        category: 'company_registry',
        placeholder: 'RO',
        tagline: 'Bolagsdata, ägarbild & årsredovisningar (SE)',
        description:
          'Hämtar grunddata (bolagsform, säte, SNI, status, registreringsdatum), årsredovisningsposter (omsättning, anställda, balansomslutning, eget kapital), koncernstruktur och verklig huvudman för bolag med organisationsnummer. Skriver till bolagskortet, den finansiella historiken och ägarbilden — underlag för screening mot art. 22 GBER / de minimis och Vinnovas målgruppskriterier. Fysiska personer lagras utan namn och personnummer.',
        features: [
          'Grunddata + registreringsdatum till bolagskortet',
          'Årsvis omsättning, anställda, balansomslutning och eget kapital',
          'Ägarbild: bolagsägare med org-nr och andel, fysiska personer bara som andel',
          'Idempotent — ägarbilden ersätts per synk, årsrader upsertas per (bolag, år)',
          'Svensk leverantör, EU-hostat'
        ],
        availability: 'available',
        sort_order: 11
      },
      {
        slug: 'bolagsverket',
        name: 'Bolagsverket',
        category: 'company_registry',
        placeholder: 'BV',
        tagline: 'Värdefulla datamängder — primärkälla (SE)',
        description:
          'Bolagsverkets kostnadsfria API för värdefulla datamängder: officiellt namn, bolagsform, registreringsdatum, SNI-kod, status och säte för alla registrerade företag. Primärkälla för grunddata på bolagskortet. Ägarbild och bokslutssiffror ingår inte (årsredovisningar levereras som dokument, inte som poster).',
        features: [
          'Officiell grunddata direkt från registret',
          'Registreringsdatum för 5-årsregeln (art. 22 GBER)',
          'SNI-kod och bolagsstatus',
          'Kostnadsfritt, OAuth2 client credentials',
          'Svensk myndighet — ingen tredjelandsöverföring'
        ],
        availability: 'available',
        sort_order: 12
      }
    ];

    for (const provider of rows) {
      let existing = null;
      try {
        existing = app.findFirstRecordByFilter(
          'integration_providers',
          `slug = "${provider.slug}"`
        );
      } catch (e) {
        /* not found */
      }
      if (existing) {
        for (const [k, v] of Object.entries(provider)) existing.set(k, v);
        if (existing.get('active') === undefined || existing.get('active') === null) {
          existing.set('active', true);
        }
        app.save(existing);
      } else {
        app.save(new Record(providers, { ...provider, active: true }));
      }
    }
  },
  (app) => {
    for (const slug of ['roaring', 'bolagsverket']) {
      try {
        const r = app.findFirstRecordByFilter('integration_providers', `slug = "${slug}"`);
        if (r) app.delete(r);
      } catch (e) {
        /* ignore */
      }
    }
  }
);
