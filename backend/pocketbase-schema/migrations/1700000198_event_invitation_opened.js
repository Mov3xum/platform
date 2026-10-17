/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 53.5 — se vilka som öppnat sin inbjudan.
//
//   event_signups.invite_opened_at ← första gången mottagaren öppnade sin
//     personliga svarslänk (/e/svar). Sätts av sidan via ett POST-anrop från
//     webbläsaren (inte vid GET, så mejlskannrar som förhandsläser länken
//     räknas inte) och av själva svaret. Ingen spårningspixel i mejlet —
//     det skulle kräva samtycke (ePrivacy/LEK) och blir fel med Apple Mail
//     Privacy Protection.
//
// Bara en tidsstämpel, inga personuppgifter (ingen IP, ingen user agent).
// Riskklass n/a. Speglas i scripts/setup-via-api.mjs och asserteras i
// verify-baseline.mjs. Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

migrate(
  (app) => {
    const signups = app.findCollectionByNameOrId('event_signups');
    if (!signups.fields.getByName('invite_opened_at')) {
      signups.fields.add(new Field({ name: 'invite_opened_at', type: 'date', required: false }));
    }
    app.save(signups);
  },
  (app) => {
    const signups = app.findCollectionByNameOrId('event_signups');
    const field = signups.fields.getByName('invite_opened_at');
    if (field) {
      signups.fields.removeById(field.id);
      app.save(signups);
    }
  }
);
