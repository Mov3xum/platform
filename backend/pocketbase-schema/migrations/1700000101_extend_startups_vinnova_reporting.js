/// <reference path="../pb_data/types.d.ts" />

// Utökar startups + tenants med fält som krävs för Vinnovas
// lägesredovisning (excellent inkubator 2025–2029) — se
// docs/reporting/vinnova-tillvaxtverket-djupanalys.md.
//
// startups:
//   - sni_code / sni_description  (NACE/SNI 2025, krävs vid de minimis +
//     e-AidRegister fr.o.m. 2026)
//   - vinnova_focus               (Vinnovas 7 affärsinriktningar, enum)
//   - state_aid_start_at          (datum då bolaget börjar ta emot statsstöd)
//   - vinnova_funding_end_at      (datum då Vinnova-finansieringen avslutas)
//
// tenants:
//   - default_hourly_rate_sek     (fallback-timpris; i underlaget 641 kr.
//     Timpris kan dock anges per tidpost — detta är bara defaulten.)
//
// GDPR/AI Act: org-nr för AB är ej PII (skäl 14); programmet kräver AB.
// vinnova_focus/sni är publik bolagsdata. Fälten får whitelistas till
// AI-kontext separat (CLAUDE.md § 10.5 p.10).

migrate(
  (app) => {
    const startups = app.findCollectionByNameOrId('startups');

    const addToStartups = (field) => {
      if (!startups.fields.getByName(field.name)) {
        startups.fields.add(new Field(field));
      }
    };

    addToStartups({ name: 'sni_code', type: 'text', required: false, max: 20 });
    addToStartups({ name: 'sni_description', type: 'text', required: false, max: 300 });
    addToStartups({
      name: 'vinnova_focus',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: [
        'agro',
        'industriell_teknik',
        'life_science',
        'miljo_energi',
        'mjukvara_ict',
        'upplevelseindustri',
        'ovrigt'
      ]
    });
    addToStartups({ name: 'state_aid_start_at', type: 'date', required: false });
    addToStartups({ name: 'vinnova_funding_end_at', type: 'date', required: false });

    app.save(startups);

    const tenants = app.findCollectionByNameOrId('tenants');
    if (!tenants.fields.getByName('default_hourly_rate_sek')) {
      tenants.fields.add(
        new Field({
          name: 'default_hourly_rate_sek',
          type: 'number',
          required: false,
          min: 0,
          max: 100000
        })
      );
      app.save(tenants);
    }
  },
  (app) => {
    const startups = app.findCollectionByNameOrId('startups');
    for (const name of [
      'sni_code',
      'sni_description',
      'vinnova_focus',
      'state_aid_start_at',
      'vinnova_funding_end_at'
    ]) {
      const f = startups.fields.getByName(name);
      if (f) startups.fields.removeById(f.id);
    }
    app.save(startups);

    const tenants = app.findCollectionByNameOrId('tenants');
    const rate = tenants.fields.getByName('default_hourly_rate_sek');
    if (rate) {
      tenants.fields.removeById(rate.id);
      app.save(tenants);
    }
  }
);
