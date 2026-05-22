/// <reference path="../pb_data/types.d.ts" />

// Lägger till kontakt-/adressfält på startups från Excel-arket "Företag"
// (kolumnerna E-post, Webbplats, Stad, Adress, Postnummer).
//
// CLAUDE.md § 9.3 / § 10.2 — GDPR:
//   • `email` är PII och skickas INTE in i AI-kontext (svartlistas i
//     apps/web/src/lib/ai/context.ts).
//   • `website`, `street_address`, `postal_code`, `city` är icke-PII
//     bolagsdata och tillåts i portfölj-/startup-kontexten.
//
// `kommun` finns redan sedan 1700000058 (Movexum-region). `city` är fri
// stadstext från CRM-importen — kan skilja sig från kommun (t.ex. ort
// inom kommun) och bevaras separat för datadrivna analyser.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');

    const addText = (name, max) => {
      if (!collection.fields.getByName(name)) {
        collection.fields.add(
          new Field({ name, type: 'text', required: false, max })
        );
      }
    };

    // email-typ är inbyggd i PB och validerar format.
    if (!collection.fields.getByName('email')) {
      collection.fields.add(
        new Field({ name: 'email', type: 'email', required: false })
      );
    }

    if (!collection.fields.getByName('website')) {
      collection.fields.add(
        new Field({ name: 'website', type: 'url', required: false })
      );
    }

    addText('city', 100);
    addText('street_address', 200);
    addText('postal_code', 20);

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');
    const removed = ['email', 'website', 'city', 'street_address', 'postal_code'];
    for (const name of removed) {
      const f = collection.fields.getByName(name);
      if (f) collection.fields.remove(f.id);
    }
    return app.save(collection);
  }
);
