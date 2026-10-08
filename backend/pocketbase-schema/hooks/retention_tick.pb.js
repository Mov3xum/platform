/// <reference path="../pb_data/types.d.ts" />

// Datalagring — daglig gallring (GDPR art. 5.1 e lagringsminimering,
// SOC 2 CC6/P4, ISO 27001 A.8.10 radering av information).
//
// PocketBase JSVM-cron som körs varje dag kl. 03:17 UTC och raderar rader som
// passerat sin lagringstid i BEGRÄNSADE omgångar (högst MOVEXUM_RETENTION_BATCH
// rader per kollektion och körning, default 2000) så att en eftersläpning
// betas av över flera nätter i stället för att låsa databasen.
//
// Lagringstider (dagar, efter `created` om inget annat anges):
//   notifications            lästa (read_at satt) > 90, alla > 365
//   ai_usage_events          > 730   (månadstotaler bevaras i ai_usage_monthly)
//   agent_actions            > 1095  (3 år audit-spår, SOC 2/ISO-bevis; golv 365)
//   compass_security_events  > 365
//   web_cache                > 2     (efter fetched_at)
//   rate_limits / app_locks  utgångna (expires_at < nu) — om kollektionerna finns
//
// Miljövariabler (Coolify på PocketBase-resursen, aldrig i koden):
//   MOVEXUM_RETENTION_DISABLED=1                 stänger av gallringen helt
//   MOVEXUM_RETENTION_BATCH                      max rader/kollektion/körning
//   MOVEXUM_RETENTION_NOTIFICATIONS_READ_DAYS    default 90
//   MOVEXUM_RETENTION_NOTIFICATIONS_DAYS         default 365
//   MOVEXUM_RETENTION_AI_USAGE_DAYS              default 730 (golv 100)
//   MOVEXUM_RETENTION_AGENT_ACTIONS_DAYS         default 1095 (golv 365)
//   MOVEXUM_RETENTION_COMPASS_SECURITY_DAYS      default 365 (golv 30)
//   MOVEXUM_RETENTION_WEB_CACHE_DAYS             default 2
// Ogiltiga värden faller tillbaka på default; värden under golvet höjs till
// golvet (en felskriven env får aldrig radera audit-spåret).
//
// Saknas en kollektion eller dess datumfält hoppas den över (migration-only-
// familjer, äldre instanser). Loggen innehåller BARA antal per kollektion —
// aldrig id:n, innehåll eller personuppgifter (§ 10.3 A.8.15).
//
// OBS: PB:s JSVM kör varje handler i en isolerad kontext — variabler och
// funktioner utanför callbacken är INTE åtkomliga där. Allt ligger därför
// inuti handlern.

cronAdd('movexum-retention-tick', '17 3 * * *', () => {
  if (($os.getenv('MOVEXUM_RETENTION_DISABLED') || '').trim() === '1') return;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const PAGE = 500;

  const intEnv = (name, fallback, min, max) => {
    const raw = ($os.getenv(name) || '').trim();
    if (!/^\d+$/.test(raw)) return fallback;
    const n = parseInt(raw, 10);
    if (!(n > 0)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  // PB lagrar datum som "YYYY-MM-DD HH:MM:SS.sssZ"; jämförelsen är textuell,
  // så parametern måste ha samma format (mellanslag, inte "T").
  const pbDate = (ms) => new Date(ms).toISOString().replace('T', ' ');

  const batch = intEnv('MOVEXUM_RETENTION_BATCH', 2000, 1, 10000);
  const now = Date.now();
  const cutoff = (days) => pbDate(now - days * DAY_MS);

  const readDays = intEnv('MOVEXUM_RETENTION_NOTIFICATIONS_READ_DAYS', 90, 7, 3650);
  const allDays = intEnv('MOVEXUM_RETENTION_NOTIFICATIONS_DAYS', 365, 30, 3650);

  // { collection, fields (måste finnas), filter, params, label }
  const specs = [
    {
      collection: 'notifications',
      fields: ['created', 'read_at'],
      filter: 'created < {:hard} || (read_at != "" && created < {:read})',
      params: { hard: cutoff(Math.max(allDays, readDays)), read: cutoff(readDays) }
    },
    {
      collection: 'ai_usage_events',
      fields: ['created'],
      filter: 'created < {:cut}',
      params: { cut: cutoff(intEnv('MOVEXUM_RETENTION_AI_USAGE_DAYS', 730, 100, 3650)) }
    },
    {
      collection: 'agent_actions',
      fields: ['created'],
      filter: 'created < {:cut}',
      params: { cut: cutoff(intEnv('MOVEXUM_RETENTION_AGENT_ACTIONS_DAYS', 1095, 365, 3650)) }
    },
    {
      collection: 'compass_security_events',
      fields: ['created'],
      filter: 'created < {:cut}',
      params: { cut: cutoff(intEnv('MOVEXUM_RETENTION_COMPASS_SECURITY_DAYS', 365, 30, 3650)) }
    },
    {
      collection: 'web_cache',
      fields: ['fetched_at'],
      filter: 'fetched_at != "" && fetched_at < {:cut}',
      params: { cut: cutoff(intEnv('MOVEXUM_RETENTION_WEB_CACHE_DAYS', 2, 1, 365)) }
    },
    {
      collection: 'rate_limits',
      fields: ['expires_at'],
      filter: 'expires_at != "" && expires_at < {:now}',
      params: { now: pbDate(now) }
    },
    {
      collection: 'app_locks',
      fields: ['expires_at'],
      filter: 'expires_at != "" && expires_at < {:now}',
      params: { now: pbDate(now) }
    }
  ];

  const summary = [];
  for (let s = 0; s < specs.length; s++) {
    const spec = specs[s];

    let collection;
    try {
      collection = $app.findCollectionByNameOrId(spec.collection);
    } catch (_) {
      continue; // kollektionen finns inte på den här instansen
    }
    let missingField = '';
    for (let f = 0; f < spec.fields.length; f++) {
      if (!collection.fields.getByName(spec.fields[f])) {
        missingField = spec.fields[f];
        break;
      }
    }
    if (missingField) {
      console.log('[retention] skip', spec.collection, '(saknar fält ' + missingField + ')');
      continue;
    }

    let deleted = 0;
    let failed = 0;
    while (deleted + failed < batch) {
      const limit = Math.min(PAGE, batch - deleted - failed);
      let rows;
      try {
        rows = $app.findRecordsByFilter(spec.collection, spec.filter, spec.fields[0], limit, 0, spec.params);
      } catch (err) {
        console.log('[retention] query failed', spec.collection, String(err && err.message ? err.message : err));
        break;
      }
      if (!rows || rows.length === 0) break;

      const before = deleted;
      for (let i = 0; i < rows.length; i++) {
        try {
          $app.delete(rows[i]);
          deleted++;
        } catch (_) {
          failed++;
        }
      }
      // Gick ingen rad att radera (t.ex. en referens blockerar) — avbryt så
      // samma sida inte hämtas om och om igen.
      if (deleted === before) break;
      if (rows.length < limit) break;
    }

    if (deleted > 0 || failed > 0) {
      summary.push(spec.collection + '=' + deleted + (failed > 0 ? ' (fel ' + failed + ')' : ''));
    }
  }

  if (summary.length > 0) console.log('[retention] raderade:', summary.join(', '));
});
