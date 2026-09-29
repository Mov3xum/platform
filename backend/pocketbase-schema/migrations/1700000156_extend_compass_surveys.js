/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 43 — Startupkompassen som ENKÄTMOTOR. Samma quiz-/formulär-motor
// som intaget bär nu även kundnöjdhet, NPS efter event, partnerenkät och
// (anonymt) medarbetarindex, så att målstyrningens indikatorer (§ 42) får
// datakällor utan en ny formulärmotor.
//
//   compass_modules:
//     • purpose (select) — `intake` (default/saknat = dagens beteende) eller
//       `survey`. En enkätmodul skapar ALDRIG lead; svaren lagras per fråga i
//       compass_responses via en conversation med subjekt.
//     • subject_kind (select) — vad enkäten handlar om: none | startup |
//       event | partner | staff. Subjektet skickas som `?om=<id>` i den
//       publika länken och lagras på conversation.
//     • anonymous (bool) — inga identifierare alls (ingen session, ingen
//       ip-hash, inget lead). Aggregat visas först vid ≥ 5 svar
//       (k-anonymitet, @platform/shared compass-survey.ts).
//
//   compass_conversations:
//     • subject_kind, subject_id — vad svaren gäller (bolag/event/partner).
//
//   goal_indicators (§ 42):
//     • source += 'survey' (union), survey_module (relation → compass_modules,
//       ingen cascade — raderas modulen lever indikatorn utan källa och
//       visas som "saknar källa").
//     • has_target (bool) — PocketBase lagrar JSON-null för tal som 0, så
//       flaggan säger om måltalet är känt (§ 42.3). Befintliga rader
//       backfillas: `has_target = target != 0` (ett lagrat 0 var aldrig ett
//       känt måltal — det var JSON-null). Läsvägen tolkar `false` som null;
//       saknat fält (omigrerad instans) som känt.
//   goal_status_entries (§ 42):
//     • has_value (bool) — samma princip för det uppmätta värdet, backfillat
//       `has_value = value != 0`.
//
// GDPR § 5: enkätsvar lagras utan koppling till person; för
// `anonymous` finns inte ens en session. Compass-familjen är migration-only
// (§ 23.4) men compass_modules inline-def i setup-via-api.mjs speglar fälten
// (§ 23.7-precedensen), och goal_indicators patchas där.
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

const SUBJECT_KINDS = ['none', 'startup', 'event', 'partner', 'staff'];

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    let changed = false;
    if (!modules.fields.getByName('purpose')) {
      modules.fields.add(
        new Field({ name: 'purpose', type: 'select', required: false, maxSelect: 1, values: ['intake', 'survey'] })
      );
      changed = true;
    }
    if (!modules.fields.getByName('subject_kind')) {
      modules.fields.add(
        new Field({ name: 'subject_kind', type: 'select', required: false, maxSelect: 1, values: SUBJECT_KINDS })
      );
      changed = true;
    }
    if (!modules.fields.getByName('anonymous')) {
      modules.fields.add(new Field({ name: 'anonymous', type: 'bool', required: false }));
      changed = true;
    }
    if (changed) app.save(modules);

    const conversations = app.findCollectionByNameOrId('compass_conversations');
    let convChanged = false;
    if (!conversations.fields.getByName('subject_kind')) {
      conversations.fields.add(
        new Field({ name: 'subject_kind', type: 'select', required: false, maxSelect: 1, values: SUBJECT_KINDS })
      );
      convChanged = true;
    }
    if (!conversations.fields.getByName('subject_id')) {
      conversations.fields.add(new Field({ name: 'subject_id', type: 'text', required: false, max: 64 }));
      convChanged = true;
    }
    if (convChanged) app.save(conversations);

    // goal_indicators: source += 'survey' (union, ersätt aldrig listan) +
    // survey_module-relation. Fail-soft om målstyrningen (1700000155) saknas.
    try {
      const indicators = app.findCollectionByNameOrId('goal_indicators');
      let indChanged = false;
      const source = indicators.fields.getByName('source');
      if (source) {
        const values = Array.from(source.values || []);
        if (!values.includes('survey')) {
          source.values = [...values, 'survey'];
          indChanged = true;
        }
      }
      if (!indicators.fields.getByName('has_target')) {
        indicators.fields.add(new Field({ name: 'has_target', type: 'bool', required: false }));
        indChanged = true;
      }
      if (!indicators.fields.getByName('survey_module')) {
        indicators.fields.add(
          new Field({
            name: 'survey_module',
            type: 'relation',
            required: false,
            collectionId: modules.id,
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          })
        );
        indChanged = true;
      }
      if (indChanged) app.save(indicators);
      // Backfill: rader skapade innan flaggan fanns. 0 = JSON-null (okänt).
      for (const row of app.findAllRecords('goal_indicators')) {
        if (row.getBool('has_target')) continue;
        const known = Number(row.get('target') || 0) !== 0;
        if (!known) continue;
        row.set('has_target', true);
        app.save(row);
      }
    } catch (e) {
      // goal_indicators saknas — målstyrningen är inte migrerad ännu.
    }
    try {
      const entries = app.findCollectionByNameOrId('goal_status_entries');
      if (!entries.fields.getByName('has_value')) {
        entries.fields.add(new Field({ name: 'has_value', type: 'bool', required: false }));
        app.save(entries);
      }
      for (const row of app.findAllRecords('goal_status_entries')) {
        if (row.getBool('has_value')) continue;
        const known = Number(row.get('value') || 0) !== 0;
        if (!known) continue;
        row.set('has_value', true);
        app.save(row);
      }
    } catch (e) {
      // goal_status_entries saknas — målstyrningen är inte migrerad ännu.
    }
  },
  (app) => {
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      for (const name of ['purpose', 'subject_kind', 'anonymous']) {
        const fld = modules.fields.getByName(name);
        if (fld) modules.fields.remove(fld.id);
      }
      app.save(modules);
    } catch (e) {
      /* ignore */
    }
    try {
      const conversations = app.findCollectionByNameOrId('compass_conversations');
      for (const name of ['subject_kind', 'subject_id']) {
        const fld = conversations.fields.getByName(name);
        if (fld) conversations.fields.remove(fld.id);
      }
      app.save(conversations);
    } catch (e) {
      /* ignore */
    }
    try {
      const indicators = app.findCollectionByNameOrId('goal_indicators');
      for (const name of ['survey_module', 'has_target']) {
        const fld = indicators.fields.getByName(name);
        if (fld) indicators.fields.remove(fld.id);
      }
      app.save(indicators);
    } catch (e) {
      /* ignore */
    }
    try {
      const entries = app.findCollectionByNameOrId('goal_status_entries');
      const fld = entries.fields.getByName('has_value');
      if (fld) entries.fields.remove(fld.id);
      app.save(entries);
    } catch (e) {
      /* ignore */
    }
  }
);
