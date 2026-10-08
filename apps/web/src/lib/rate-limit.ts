import 'server-only';

/**
 * Enkel in-memory rate limiter för brute-force-skydd (login, reset).
 *
 * Begränsningar: state lever i processminnet, så det nollställs vid
 * omstart och delas inte mellan flera instanser. För MVP (en Coolify-
 * container per tjänst) räcker det. Vid horisontell skalning bör detta
 * lyftas till Redis/PB (CLAUDE.md § 10.3 A.8.x).
 *
 * Endast misslyckade försök räknas: `recordFailure` ökar räknaren,
 * `clearFailures` nollställer den vid lyckad inloggning.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  blocked: boolean;
  retryAfterSec: number;
}

/** Hårt tak på antalet nycklar — skyddar processminnet mot en flod av unika
 * IP-/e-post-nycklar (DoS). Vid taket evicteras de äldsta (Map behåller
 * insättningsordning); hellre en förlorad räknare än en OOM-krasch. */
const MAX_BUCKETS = 50_000;
const SWEEP_EVERY = 500;
let writesSinceSweep = 0;

function sweep(now: number): void {
  // Städa utgångna nycklar regelbundet (inte bara när kartan redan är stor).
  if (++writesSinceSweep >= SWEEP_EVERY || buckets.size >= MAX_BUCKETS) {
    writesSinceSweep = 0;
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function checkRateLimit(key: string, max: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return { blocked: false, retryAfterSec: 0 };
  if (b.count >= max) {
    return { blocked: true, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}
