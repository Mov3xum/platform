/// <reference path="../pb_data/types.d.ts" />

// AI-förbrukningens månadsrollup (CLAUDE.md § 9.6 / § 28, migration
// 1700000185).
//
// Efter varje skapad `ai_usage_events`-rad räknas händelsen in i
// `ai_usage_monthly` (en rad per tenant + kalendermånad UTC) med EN atomisk
// SQL-upsert: `INSERT … ON CONFLICT(tenant, month) DO UPDATE SET x = x + …`.
// SQLite serialiserar skrivningar, så samtidiga events kan aldrig tappa en
// ökning (ingen läs-ändra-skriv i JS). Månadstaket och AI-analysen läser
// sedan en rad i stället för att summera tusentals events.
//
// Fail-soft (SOC 2 § 10.4): ett fel här får ALDRIG fälla själva
// event-skapandet — hooken körs efter commit och sväljer allt. Saknas
// rollup-raden (t.ex. kollektionen ännu inte migrerad) faller appen tillbaka
// på att summera events (`budget.server.ts`). Ingen PII: bara tenant-id,
// månad och tekniska siffror; inget loggas om användaren.
//
// Rollupen är OBEROENDE av rådatans lagringstid: den bara ökar vid create och
// rörs aldrig när gamla `ai_usage_events` gallras (retention) — historiska
// månadssummor överlever alltså att råraderna raderas. Lägg därför ALDRIG en
// delete-hook som minskar raden.

// OBS: PB:s JSVM kör varje handler i en isolerad kontext — konstanter och
// hjälpfunktioner MÅSTE deklareras inne i handlern (inte på toppnivå).
onRecordAfterCreateSuccess((e) => {
  try {
    const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const record = e.record;
    const tenant = record ? String(record.get('tenant') || '') : '';
    if (tenant) {
      // Månad ur postens created (samma källa som backfillen och
      // datumfiltren i appen); faller tillbaka på nu (UTC).
      let createdStr = '';
      try {
        const dt = record.getDateTime('created');
        if (dt && !dt.isZero()) createdStr = String(dt.string());
      } catch (err) {
        createdStr = '';
      }
      const nowStr = new Date().toISOString().replace('T', ' ');
      const month = (/^\d{4}-\d{2}/.test(createdStr) ? createdStr : nowStr).slice(0, 7);

      const nonNeg = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };

      let id;
      try {
        id = $security.randomStringWithAlphabet(15, ID_ALPHABET);
      } catch (err) {
        id = String($security.randomString(15)).toLowerCase();
      }

      const app = e.app || $app;
      app
        .db()
        .newQuery(
          'INSERT INTO ai_usage_monthly (id, tenant, month, cost_usd, tokens_in, tokens_out, events, created, updated) ' +
            'VALUES ({:id}, {:tenant}, {:month}, {:cost}, {:tin}, {:tout}, 1, {:now}, {:now}) ' +
            'ON CONFLICT(tenant, month) DO UPDATE SET ' +
            'cost_usd = COALESCE(cost_usd, 0) + excluded.cost_usd, ' +
            'tokens_in = COALESCE(tokens_in, 0) + excluded.tokens_in, ' +
            'tokens_out = COALESCE(tokens_out, 0) + excluded.tokens_out, ' +
            'events = COALESCE(events, 0) + 1, ' +
            'updated = excluded.updated'
        )
        .bind({
          id: id,
          tenant: tenant,
          month: month,
          cost: nonNeg(record.get('cost_estimate_usd')),
          tin: Math.round(nonNeg(record.get('tokens_in'))),
          tout: Math.round(nonNeg(record.get('tokens_out'))),
          now: nowStr
        })
        .execute();
    }
  } catch (err) {
    // Kollektionen saknas (migration 1700000185 ej körd) eller SQL-fel —
    // tyst no-op, loggat utan PII.
    console.log('[ai-usage-rollup] upsert failed:', err);
  }

  e.next();
}, 'ai_usage_events');
