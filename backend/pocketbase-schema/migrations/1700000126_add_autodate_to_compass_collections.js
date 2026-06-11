/// <reference path="../pb_data/types.d.ts" />

// Lägger till `created`/`updated`-autodate-fält på compass-kollektionerna
// (Startupkompassen, CLAUDE.md § 23). Samma grundorsak som migration
// 1700000125 (RAG-kollektionerna): i PocketBase v0.23 är created/updated
// VANLIGA autodate-fält som måste deklareras explicit — `new Collection(...)`
// i en JSVM-migration auto-lägger dem INTE. Migration 1700000039 skapade hela
// compass-familjen utan dem, vilket gav det rapporterade symptomet "leads
// visas inte fast quizet slutförts":
//
//   1. `listLeads` (/inflode/leads) sorterar på `-created` → PB svarar 400 →
//      catch → tom lista. Leadet SKAPADES (quiz-result-routen lyckas och
//      besökaren ser sitt resultat) men syntes aldrig för staff.
//   2. Samma fel träffar CSV-exporten (`listLeadsForExport`), chatt-historiken
//      (`listMessages`, sort `created`), säkerhetsloggen
//      (`listSecurityEvents`, sort `-created`) samt dashboard/analys som
//      filtrerar på `created >=` (`getCompassDashboard`/`getLeadAnalytics`).
//
// Idempotent (hoppar fält som redan finns). Befintliga rader får tomma värden
// tills nästa write — sortering fungerar ändå (NULL sorterar konsekvent).
// Compass är migration-only (§ 23.4) — speglas medvetet inte i
// setup-via-api.mjs.
//
// Ingen ny datakategori, ingen PII-väg, inga regeländringar (§ 10.3 A.8.32 —
// nytt oföränderligt filnummer).

const COLLECTIONS = [
  'compass_lead_sources',
  'compass_leads',
  'compass_conversations',
  'compass_messages',
  'compass_modules',
  'compass_questions',
  'compass_responses',
  'compass_security_events',
  'compass_brand'
];

migrate(
  (app) => {
    for (const name of COLLECTIONS) {
      let collection;
      try {
        collection = app.findCollectionByNameOrId(name);
      } catch (_) {
        continue; // kollektionen saknas i denna instans — hoppa
      }

      let changed = false;
      if (!collection.fields.getByName('created')) {
        collection.fields.add(
          new Field({ name: 'created', type: 'autodate', onCreate: true, onUpdate: false })
        );
        changed = true;
      }
      if (!collection.fields.getByName('updated')) {
        collection.fields.add(
          new Field({ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true })
        );
        changed = true;
      }
      if (changed) app.save(collection);
    }
  },
  (app) => {
    // Ingen down-migration: att ta bort created/updated raderar
    // tidsstämpel-data (audit-spår, ISO 27001 A.8.15).
  }
);
