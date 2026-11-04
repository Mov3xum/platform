/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 49 — Önskemål & buggar: fyrstegsflöde + testare (2026-11).
//
// Kortet gick tidigare Öppen → Besvarad → Klar. Nu följer det arbetet:
//   open → in_progress (Påbörjad) → awaiting_feedback (Väntar återkoppling)
//   → done (Klar).
// "Väntar återkoppling" = ledningen har åtgärdat och ber en kollega — som
// standard den som lade upp kortet — TESTA att det blev rätt. Testaren
// återkopplar i systemet ("fungerar" ⇒ klar, "fungerar inte" ⇒ tillbaka till
// påbörjad med en not).
//
// Ändringar (expand/contract — inget tas bort):
//   • status: select-värdena UNIONAS med in_progress + awaiting_feedback.
//     Det äldre `answered` ligger kvar i schemat så befintliga rader aldrig
//     blir ogiltiga; raderna backfillas till in_progress här, och läsvägen
//     (`normalizeFeedbackStatus`) tolkar ett kvarvarande `answered` likadant.
//   • tester (relation → users, valfri): vem som ska testa/återkoppla.
//   • test_note (text ≤ 2000): testarens återkoppling (personnummer-saneras
//     på skrivvägen, § 15.6 — aldrig i audit, bara längd).
//   • tested_at (date): när återkopplingen gavs.
//   • updateRule: även testaren får uppdatera sitt kort (fältgränsen —
//     att testaren bara skriver test_note/tested_at/status — ligger i
//     server-actionen, som är den primära gränsen; § 21.3).
//
// PII: `tester` är en intern användarrelation (visningsnamn, aldrig e-post;
// når aldrig AI-kontexten). Riskklass n/a (ingen AI-inferens). Speglas i
// scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs
// (REQUIRED_APP_FIELDS + REQUIRED_SELECT_VALUES) eftersom PB släpper okända
// fält tyst (§ 24.4). Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

function unionSelect(col, fieldName, values) {
  const field = col.fields.getByName(fieldName);
  if (!field) return false;
  const current = Array.from(field.values || []);
  const missing = values.filter((v) => !current.includes(v));
  if (missing.length === 0) return false;
  field.values = [...current, ...missing];
  return true;
}

migrate(
  (app) => {
    let col;
    try {
      col = app.findCollectionByNameOrId('feedback_items');
    } catch (e) {
      return; // modulen (1700000176) saknas — inget att utöka
    }
    const usersCol = app.findCollectionByNameOrId('users');

    unionSelect(col, 'status', ['in_progress', 'awaiting_feedback']);

    const add = (f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add({
      name: 'tester',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    add({ name: 'test_note', type: 'text', required: false, max: 2000 });
    add({ name: 'tested_at', type: 'date', required: false });

    const indexes = Array.from(col.indexes || []);
    if (!indexes.some((i) => String(i).includes('idx_feedback_items_tester'))) {
      col.indexes = [...indexes, 'CREATE INDEX idx_feedback_items_tester ON feedback_items (tester)'];
    }

    col.updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = author || @request.auth.id = tester || ${STAFF_OR_LEAD})`;
    app.save(col);

    // Backfill: det gamla "Besvarad" = ledningen har tagit tag i det ⇒ Påbörjad.
    for (const row of app.findRecordsByFilter('feedback_items', "status = 'answered'", '', 5000, 0)) {
      row.set('status', 'in_progress');
      app.save(row);
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('feedback_items');
      for (const name of ['tester', 'test_note', 'tested_at']) {
        const f = col.fields.getByName(name);
        if (f) col.fields.removeById(f.id);
      }
      col.indexes = Array.from(col.indexes || []).filter((i) => !String(i).includes('idx_feedback_items_tester'));
      col.updateRule = `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.id = author || ${STAFF_OR_LEAD})`;
      app.save(col);
      // Select-värdena lämnas (rader kan bära dem).
    } catch (e) {
      /* ignore */
    }
  }
);
