/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 61 — users.organization: vilken organisation en användare
// företräder (t.ex. "Sandvikens kommun", "Högskolan i Gävle").
//
// Används av SPARK: en partner som sprider den publika anmälan får sin
// organisation visad för företaget ("Du har fått länken av Sandvikens
// kommun") och förifylld som intervjuande organisation. Självservice-fält —
// fältlåset på users (1700000174) omfattar det inte, och det ger ingen
// behörighet. Uppgift om arbetsgivare, ingen särskild kategori; visas bara
// när användaren själv delar sin länk. Speglas i setup-via-api.mjs.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    if (!users.fields.getByName('organization')) {
      users.fields.add(new Field({ name: 'organization', type: 'text', required: false, max: 120 }));
      app.save(users);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const f = users.fields.getByName('organization');
    if (f) {
      users.fields.remove(f);
      app.save(users);
    }
  }
);
