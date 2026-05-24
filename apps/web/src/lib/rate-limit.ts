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

function sweep(now: number): void {
  // Opportunistisk städning så att kartan inte växer obegränsat.
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
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
