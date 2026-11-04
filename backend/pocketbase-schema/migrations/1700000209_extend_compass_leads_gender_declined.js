/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — "Vill inte ange" som svar på kön på grundare
// (CLAUDE.md § 23.11). compass_leads.founder_gender får värdet
// `vill_inte_ange` (union, befintliga värden behålls) så att fältet kan göras
// obligatoriskt i avsnittet "Dina uppgifter" utan att tvinga fram en uppgift:
// besökaren har alltid en utväg (GDPR art. 9-klass, samma hantering som
// startups.founder_gender). Speglas i setup-via-api.mjs (compass_leads
// inline-def) och i FOUNDER_GENDER_OPTIONS i
// packages/shared/src/compass-contact.ts.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    const leads = app.findCollectionByNameOrId('compass_leads');
    const field = leads.fields.getByName('founder_gender');
    if (!field) {
      leads.fields.add(
        new Field({
          name: 'founder_gender',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['kvinna', 'man', 'mixat_team', 'vill_inte_ange']
        })
      );
      app.save(leads);
      return;
    }
    const values = Array.from(field.values || []);
    if (!values.includes('vill_inte_ange')) {
      field.values = [...values, 'vill_inte_ange'];
      app.save(leads);
    }
  },
  (app) => {
    const leads = app.findCollectionByNameOrId('compass_leads');
    const field = leads.fields.getByName('founder_gender');
    if (!field) return;
    field.values = Array.from(field.values || []).filter((v) => v !== 'vill_inte_ange');
    app.save(leads);
  }
);
