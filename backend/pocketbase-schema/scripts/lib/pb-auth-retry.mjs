/**
 * Delad retry-logik (fast fördröjning, INTE exponentiell backoff) för
 * PocketBase superuser-auth.
 *
 * PB v0.23 rate-limitar `_superusers/auth-with-password`. I CI:s
 * "Self-healing rule sync via API"-jobb (sync-pocketbase*.yml) loggar flera
 * fristående Node-skript in som superuser efter varandra i samma jobb
 * (setup-via-api.mjs, seed-innovationspotential-quiz.mjs,
 * diagnose-migrations.mjs, verify-baseline.mjs) — utan retry kan det tredje/
 * fjärde inloggningsförsöket få ett 429 "Too Many Requests" och fälla hela
 * jobbet. Denna modul är den EN källan för retry-policyn så den inte kan
 * drifta isär mellan skripten.
 *
 * Fördröjningen mellan försök är MEDVETET konstant (`PB_AUTH_RETRY_DELAY_MS`,
 * default 5000ms) snarare än exponentiell: PB:s rate-limit-fönster är kort
 * och en handfull skript i samma jobb behöver bara vänta ut det, så en enkel
 * fast fördröjning räcker och är lättare att resonera om (deterministisk
 * övre gräns: attempts × delay). Höj `PB_AUTH_RETRY_DELAY_MS`/
 * `PB_AUTH_RETRY_ATTEMPTS` via env om ett striktare rate-limit upptäcks.
 */

export const PB_AUTH_RETRY_ATTEMPTS = Number(process.env.PB_AUTH_RETRY_ATTEMPTS || 12);
export const PB_AUTH_RETRY_DELAY_MS = Number(process.env.PB_AUTH_RETRY_DELAY_MS || 5000);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldRetrySuperuserAuth(err) {
  const status = Number(err?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  const code = String(err?.originalError?.code || err?.cause?.code || '').toUpperCase();
  return ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(code);
}

/**
 * Autentiserar som PocketBase superuser med retry (fast fördröjning) på
 * transienta fel (429/5xx/nätverk). Kastar ALDRIG — returnerar `null` vid lyckad auth,
 * annars det sista felet, så anroparen formaterar sitt eget felmeddelande
 * (varje skript har sin egen stil på fel-/loggmeddelanden).
 *
 * @param {import('pocketbase').default} pb
 * @param {string} email
 * @param {string} password
 * @param {{ onRetry?: (err: unknown, attempt: number, maxAttempts: number, delayMs: number) => void }} [options]
 * @returns {Promise<unknown|null>}
 */
export async function authenticateSuperuserWithRetry(pb, email, password, options = {}) {
  const { onRetry } = options;
  let authError = null;

  for (let attempt = 1; attempt <= PB_AUTH_RETRY_ATTEMPTS; attempt++) {
    try {
      await pb.collection('_superusers').authWithPassword(email, password);
      return null;
    } catch (err) {
      authError = err;
      const retryable = shouldRetrySuperuserAuth(err);
      if (!retryable || attempt === PB_AUTH_RETRY_ATTEMPTS) break;

      if (typeof onRetry === 'function') {
        onRetry(err, attempt, PB_AUTH_RETRY_ATTEMPTS, PB_AUTH_RETRY_DELAY_MS);
      }
      await sleep(PB_AUTH_RETRY_DELAY_MS);
    }
  }

  return authError;
}
