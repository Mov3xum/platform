/// <reference path="../pb_data/types.d.ts" />

// De minimis-modul (CLAUDE.md "Build-prompt: De minimis-modul"):
// `de_minimis_regelverk` är en GLOBAL, konfigurerbar katalog över EU:s
// de minimis-förordningar med takbelopp och periodtyp. Taket kan uppdateras
// utan kodändring (PB-admin) — den rena beräkningslogiken (packages/shared/
// src/de-minimis.ts) har defaults som fallback.
//
// Riskklass (EU AI Act): n/a — ren regeldata, ingen AI-inferens, inga
// personuppgifter. Globalt (ingen tenant) eftersom EU-förordningarna är
// gemensamma för alla. Skrivning är admin-only; läsning för alla inloggade.

const ANY_AUTH = '@request.auth.id != ""';
const ADMIN_ONLY = '@request.auth.roles ?= "admin"';

migrate(
  (app) => {
    const collection = new Collection({
      id: 'de_minimis_regelverk_collection',
      name: 'de_minimis_regelverk',
      type: 'base',
      fields: [
        // Förordningskod (ALLMAN/SGEI/JORDBRUK/FISKE) — fungerar som nyckel.
        {
          name: 'kod',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE']
        },
        { name: 'forordning_text', type: 'text', required: true, max: 300 },
        { name: 'tillampning', type: 'text', required: true, max: 300 },
        { name: 'tak_eur', type: 'number', required: true, min: 0 },
        {
          name: 'period',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['RULLANDE_3AR', 'BESKATTNINGSAR_3']
        },
        { name: 'giltig_t_o_m', type: 'date', required: false },
        { name: 'sort_order', type: 'number', required: false }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_de_minimis_regelverk_kod ON de_minimis_regelverk (kod)'],
      listRule: ANY_AUTH,
      viewRule: ANY_AUTH,
      createRule: `${ANY_AUTH} && ${ADMIN_ONLY}`,
      updateRule: `${ANY_AUTH} && ${ADMIN_ONLY}`,
      deleteRule: `${ANY_AUTH} && ${ADMIN_ONLY}`
    });

    app.save(collection);

    // ── Seed: de fyra kärnförordningarna (upsert på kod) ──────────────────
    const rows = [
      {
        kod: 'ALLMAN',
        forordning_text: '(EU) 2023/2831',
        tillampning: 'Allmänt stöd av mindre betydelse',
        tak_eur: 300000,
        period: 'RULLANDE_3AR',
        giltig_t_o_m: '2030-12-31',
        sort_order: 10
      },
      {
        kod: 'SGEI',
        forordning_text: '(EU) 2023/2832',
        tillampning: 'Tjänster av allmänt ekonomiskt intresse (SGEI)',
        tak_eur: 750000,
        period: 'RULLANDE_3AR',
        giltig_t_o_m: '2030-12-31',
        sort_order: 20
      },
      {
        kod: 'JORDBRUK',
        forordning_text: '(EU) 1408/2013, senast ändrad (EU) 2024/3118',
        tillampning: 'Primärproduktion av jordbruksprodukter',
        tak_eur: 50000,
        period: 'BESKATTNINGSAR_3',
        giltig_t_o_m: '2030-12-31',
        sort_order: 30
      },
      {
        kod: 'FISKE',
        forordning_text: '(EU) 717/2014',
        tillampning: 'Fiskeri- och vattenbrukssektorn',
        tak_eur: 30000,
        period: 'BESKATTNINGSAR_3',
        giltig_t_o_m: '2030-12-31',
        sort_order: 40
      }
    ];

    for (const r of rows) {
      let existing = null;
      try {
        existing = app.findFirstRecordByFilter('de_minimis_regelverk', `kod = "${r.kod}"`);
      } catch (e) {
        /* not found */
      }
      if (existing) {
        existing.set('forordning_text', r.forordning_text);
        existing.set('tillampning', r.tillampning);
        existing.set('tak_eur', r.tak_eur);
        existing.set('period', r.period);
        existing.set('giltig_t_o_m', r.giltig_t_o_m);
        existing.set('sort_order', r.sort_order);
        app.save(existing);
      } else {
        app.save(new Record(collection, r));
      }
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('de_minimis_regelverk'));
    } catch (e) {
      /* ignore */
    }
  }
);
