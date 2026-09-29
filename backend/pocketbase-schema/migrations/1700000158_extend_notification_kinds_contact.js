/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 45.3 — notiser för kontaktboken. Lägger `contact_request`
// (en kollega ber dig som kontaktägare om att få använda en kontakt) och
// `contact_decision` (ägaren har godkänt/avböjt din förfrågan) i
// notifications.kind. UNION — ersätt aldrig values-listan (§ 21.3-läxan från
// 1700000049/1700000126). `notify()` i lib/notifications-server.ts faller
// tillbaka på kind `assigned` mot ett schema där migrationen inte körts, så
// notisen tappas aldrig tyst. Payload är PII-fri (kontaktens namn + syfte
// klippt, länk till förfrågan) — samma modell som övriga notiser.

const NEW_KINDS = ['contact_request', 'contact_decision'];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('notifications');
    const kindField = col.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      const missing = NEW_KINDS.filter((k) => !current.includes(k));
      if (missing.length > 0) {
        kindField.values = [...current, ...missing];
        app.save(col);
      }
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('notifications');
    const kindField = col.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => !NEW_KINDS.includes(v));
      app.save(col);
    }
  }
);
