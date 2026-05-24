/// <reference path="../pb_data/types.d.ts" />

// Utökar agreements med fält från Excel-arket "Avtal":
//   • partner          ← "Partner"      (frisktext, t.ex. "Volvo AB")
//   • country          ← "Land"         (ISO-2 valfritt, men vi tar text
//                                         för att matcha Excel-frihet)
//   • agreement_date   ← "Avtalsdatum"  (datum då avtalet ingicks; ofta
//                                         samma som signed_at men kan
//                                         skilja om signering sker senare)
//   • notes            ← "Anteckning"   (editor)
//
// Befintliga `kind`-värden (nda, incubator_agreement, ip_assignment,
// addendum, other) räcker för Excel-kategorierna (Movexum saknar separat
// avtalstyp i CRM:t — typ är frisktext "Typ"-kolumnen, så vi mappar den
// till existerande select + lägger till `kind_label` för CRM-frisktexten).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('agreements');

    if (!collection.fields.getByName('partner')) {
      collection.fields.add(
        new Field({ name: 'partner', type: 'text', required: false, max: 200 })
      );
    }
    if (!collection.fields.getByName('country')) {
      collection.fields.add(
        new Field({ name: 'country', type: 'text', required: false, max: 60 })
      );
    }
    if (!collection.fields.getByName('agreement_date')) {
      collection.fields.add(
        new Field({ name: 'agreement_date', type: 'date', required: false })
      );
    }
    if (!collection.fields.getByName('notes')) {
      collection.fields.add(
        new Field({ name: 'notes', type: 'editor', required: false })
      );
    }
    // Excel-frisktext för "Typ" — bevarar originalvärdet utan att tvinga
    // mapping till `kind`-enumet. UI kan visa label-värdet och AI-prompt
    // kan referera detta som "agreement type".
    if (!collection.fields.getByName('kind_label')) {
      collection.fields.add(
        new Field({ name: 'kind_label', type: 'text', required: false, max: 100 })
      );
    }

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('agreements');
    for (const n of ['partner', 'country', 'agreement_date', 'notes', 'kind_label']) {
      const f = collection.fields.getByName(n);
      if (f) collection.fields.remove(f.id);
    }
    return app.save(collection);
  }
);
