/// <reference path="../pb_data/types.d.ts" />

// Backfillar VÄRDEN i de nyligen tillagda created/updated-fälten (migration
// 1700000126) på compass_leads. 1700000126 la till KOLUMNERNA, men befintliga
// rader fick tomma värden — autodate fylls först vid nästa write. Följd:
// dashboard (/inflode) och analys (/inflode/analysis) filtrerar på
// `created >= cutoff`, så äldre leads räknades i tratten (countLeadsByStatus,
// utan datumfilter) men aldrig i period-KPI:er/trend/källor — "Leads denna
// period: 0 av N" trots leads i listan. Vyerna hängde inte ihop.
//
// Värdekälla per rad (bästa tillgängliga, i ordning):
//   1. consent_at      — stämplas av alla publika flöden vid inskick → exakt.
//   2. last_contact_at — bättre approximation än inget för manuella leads.
//   3. migrations-tidpunkten (+ rowid-sekunder för stabil inbördes ordning) —
//      leadet syns då i innevarande period EN gång, hellre än att vara
//      osynligt i trenden för alltid.
//
// Idempotent (rör bara rader där created/updated är tomt). Ingen ny PII —
// kopierar bara befintliga tidsstämplar inom samma rad. Compass är
// migration-only (§ 23.4) — speglas inte i setup-via-api.mjs.

migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId('compass_leads');
    } catch (_) {
      return; // instans utan compass — hoppa
    }
    app
      .db()
      .newQuery(
        "UPDATE compass_leads SET created = COALESCE(NULLIF(consent_at, ''), NULLIF(last_contact_at, ''), strftime('%Y-%m-%d %H:%M:%f', 'now', '+' || (rowid % 600) || ' seconds') || 'Z') WHERE created IS NULL OR created = ''"
      )
      .execute();
    app
      .db()
      .newQuery(
        "UPDATE compass_leads SET updated = created WHERE (updated IS NULL OR updated = '') AND created IS NOT NULL AND created != ''"
      )
      .execute();
  },
  (app) => {
    // Ingen down-migration — syntetiska tidsstämplar kan inte säkert
    // särskiljas från riktiga i efterhand.
  }
);
