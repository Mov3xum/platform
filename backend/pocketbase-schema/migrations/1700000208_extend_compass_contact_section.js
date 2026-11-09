/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — avsnittet "Dina uppgifter" sist i intag-flödet
// (CLAUDE.md § 23.11). Inflödesansvarig (2026-11): idébeskrivningen ska
// avslutas med namn på idéägaren, e-post, telefon, kön på grundare, övriga
// teammedlemmar, kommuntillhörighet och hur besökaren kom i kontakt med
// Movexum.
//
//   compass_modules.contact_fields (json) — läge per fält
//     (hidden | optional | required), nycklar enligt CONTACT_FIELD_KEYS i
//     packages/shared/src/compass-contact.ts. Saknat fält ⇒ legacy-
//     konfigurationen (require_email/phone/organization), så ingen befintlig
//     modul ändrar utseende.
//
//   compass_leads:
//     • founder_gender (select kvinna | man | mixat_team) — GDPR art. 9-klass
//       (samma hantering som startups.founder_gender, § 10.2): frivilligt,
//       kan aldrig göras obligatoriskt, fältmaskas för AI (gender-mönstret),
//       exporteras aldrig per lead.
//     • team_members (text ≤ 2000) — namn + e-post till övriga teammedlemmar
//       (tredjeparts-PII: fältmaskas för AI, personnummer-saneras).
//     • kommun (text ≤ 80) — nyckel ur KOMMUN_OPTIONS (text, inte select, så
//       listan kan utökas utan migration; okända nycklar avvisas i koden).
//     • referral_channel (text ≤ 60) — nyckel ur REFERRAL_CHANNEL_OPTIONS.
//
// Compass-familjen är migration-only (§ 23.4) men compass_modules/
// compass_leads har inline-defs i setup-via-api.mjs (regel-sync) som speglar
// fälten. Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    if (!modules.fields.getByName('contact_fields')) {
      modules.fields.add(new Field({ name: 'contact_fields', type: 'json', required: false, maxSize: 4000 }));
      app.save(modules);
    }

    const leads = app.findCollectionByNameOrId('compass_leads');
    let changed = false;
    const add = (field) => {
      if (!leads.fields.getByName(field.name)) {
        leads.fields.add(new Field(field));
        changed = true;
      }
    };
    add({ name: 'founder_gender', type: 'select', required: false, maxSelect: 1, values: ['kvinna', 'man', 'mixat_team'] });
    add({ name: 'team_members', type: 'text', required: false, max: 2000 });
    add({ name: 'kommun', type: 'text', required: false, max: 80 });
    add({ name: 'referral_channel', type: 'text', required: false, max: 60 });
    if (changed) app.save(leads);
  },
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    const cf = modules.fields.getByName('contact_fields');
    if (cf) {
      modules.fields.removeById(cf.id);
      app.save(modules);
    }
    const leads = app.findCollectionByNameOrId('compass_leads');
    let changed = false;
    for (const name of ['founder_gender', 'team_members', 'kommun', 'referral_channel']) {
      const f = leads.fields.getByName(name);
      if (f) {
        leads.fields.removeById(f.id);
        changed = true;
      }
    }
    if (changed) app.save(leads);
  }
);
