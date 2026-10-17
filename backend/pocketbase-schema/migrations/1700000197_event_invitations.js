/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 53.5 — inbjudningar till event via plattformen.
//
//   event_signups:
//     • stage += invited, declined  ← inbjudans steg före tratten (MÅSTE
//                                     spegla EVENT_ALL_SIGNUP_STAGES)
//     • rsvp_token_hash  ← SHA-256 av svarslänkens engångstoken. Token i
//                          klartext lagras ALDRIG — den finns bara i mejlet.
//     • invited_at / invite_sent_at / responded_at ← när (inga personuppgifter)
//
//   contacts:
//     • invite_opt_out / invite_opt_out_at ← avregistrering från inbjudningar
//       (berättigat intresse + avregistrering i varje mejl, GDPR art. 21)
//
// Index på rsvp_token_hash (uppslag från den publika svarssidan). Ingen ny
// kollektion, ingen AI-inferens (riskklass n/a). Speglas i
// scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs.
// Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const STAGES = ['invited', 'declined', 'signup', 'attended', 'meeting', 'application', 'admitted'];
const TOKEN_INDEX = 'CREATE INDEX idx_signups_rsvp_token ON event_signups (rsvp_token_hash)';

migrate(
  (app) => {
    const signups = app.findCollectionByNameOrId('event_signups');
    const stage = signups.fields.getByName('stage');
    if (stage) {
      const values = Array.from(stage.values || []);
      const missing = STAGES.filter((v) => !values.includes(v));
      if (missing.length > 0) stage.values = [...values, ...missing];
    }
    const add = (col, f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add(signups, { name: 'rsvp_token_hash', type: 'text', required: false, max: 64 });
    add(signups, { name: 'invited_at', type: 'date', required: false });
    add(signups, { name: 'invite_sent_at', type: 'date', required: false });
    add(signups, { name: 'responded_at', type: 'date', required: false });
    const indexes = Array.isArray(signups.indexes) ? Array.from(signups.indexes) : [];
    if (!indexes.some((i) => String(i).includes('idx_signups_rsvp_token'))) {
      signups.indexes = [...indexes, TOKEN_INDEX];
    }
    app.save(signups);

    const contacts = app.findCollectionByNameOrId('contacts');
    add(contacts, { name: 'invite_opt_out', type: 'bool', required: false });
    add(contacts, { name: 'invite_opt_out_at', type: 'date', required: false });
    app.save(contacts);
  },
  (app) => {
    try {
      const signups = app.findCollectionByNameOrId('event_signups');
      if (Array.isArray(signups.indexes)) {
        signups.indexes = signups.indexes.filter((i) => !String(i).includes('idx_signups_rsvp_token'));
      }
      for (const n of ['rsvp_token_hash', 'invited_at', 'invite_sent_at', 'responded_at']) {
        const f = signups.fields.getByName(n);
        if (f) signups.fields.removeById(f.id);
      }
      app.save(signups);
    } catch (e) {
      // ignore
    }
    try {
      const contacts = app.findCollectionByNameOrId('contacts');
      for (const n of ['invite_opt_out', 'invite_opt_out_at']) {
        const f = contacts.fields.getByName(n);
        if (f) contacts.fields.removeById(f.id);
      }
      app.save(contacts);
    } catch (e) {
      // ignore
    }
  }
);
