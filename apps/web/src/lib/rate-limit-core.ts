/**
 * Ren, enhetstestad kärna för rate-limitern (`rate-limit.ts`).
 *
 * Ingen PocketBase, inga `@/`-importer, inget `server-only` — så att
 * `yarn test` kan ladda modulen direkt. IO-skalet (`rate-limit.ts`) kopplar
 * in PocketBase-lagret (`rate_limits`, migration 1700000184) och faller
 * tillbaka på `MemoryRateLimiter` när det delade lagret inte går att nå.
 *
 * Varför delat lager: med flera web-containrar (horisontell skalning) hade
 * varje container sin egen räknare, så en angripare fick N × gränsen genom
 * att lastbalanseraren spred försöken (CLAUDE.md § 10.3 A.8.x, § 21.8).
 *
 * GDPR § 5: nycklarna bär e-post/IP (t.ex. `login:acct:<ip>:<e-post>`). I det
 * delade lagret skrivs ALDRIG nyckeln i klartext — bara en HMAC/SHA-256 av
 * den (`hashRateLimitKey`). Processminnet håller klartextnyckeln som förut
 * (lämnar aldrig processen, försvinner vid omstart).
 */
import { createHash, createHmac } from 'node:crypto';

export interface RateLimitResult {
  blocked: boolean;
  retryAfterSec: number;
}

export interface RateLimitBucket {
  count: number;
  /** Epoch-ms då fönstret löper ut. */
  resetAt: number;
}

export const NOT_BLOCKED: RateLimitResult = Object.freeze({ blocked: false, retryAfterSec: 0 });

/** Avgör om en bucket blockerar vid `max` misslyckade försök. */
export function evaluateBucket(
  bucket: RateLimitBucket | null | undefined,
  max: number,
  now: number
): RateLimitResult {
  if (!bucket || bucket.resetAt <= now) return { blocked: false, retryAfterSec: 0 };
  if (bucket.count >= max) {
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

/**
 * Nästa tillstånd efter ett registrerat försök: utgånget/saknat fönster
 * startar om på 1, annars räknas det upp (fönstret förlängs inte).
 */
export function nextBucket(
  bucket: RateLimitBucket | null | undefined,
  windowMs: number,
  now: number
): RateLimitBucket & { fresh: boolean } {
  if (!bucket || bucket.resetAt <= now) {
    return { count: 1, resetAt: now + Math.max(1, windowMs), fresh: true };
  }
  return { count: bucket.count + 1, resetAt: bucket.resetAt, fresh: false };
}

/** Hårt tak på antalet nycklar i processminnet — skyddar mot en flod av unika
 * IP-/e-post-nycklar (DoS). Vid taket evicteras de äldsta (Map behåller
 * insättningsordning); hellre en förlorad räknare än en OOM-krasch. */
export const MAX_MEMORY_BUCKETS = 50_000;
const SWEEP_EVERY = 500;

/**
 * In-memory-limitern (tidigare hela `rate-limit.ts`). Används som
 * fail-open-reserv när det delade lagret inte svarar, och som ett billigt
 * första filter före PB-anropet.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private writesSinceSweep = 0;
  private readonly maxBuckets: number;

  constructor(maxBuckets: number = MAX_MEMORY_BUCKETS) {
    this.maxBuckets = maxBuckets;
  }

  get size(): number {
    return this.buckets.size;
  }

  check(key: string, max: number, now: number): RateLimitResult {
    return evaluateBucket(this.buckets.get(key), max, now);
  }

  record(key: string, windowMs: number, now: number): RateLimitBucket {
    this.sweep(now);
    const next = nextBucket(this.buckets.get(key), windowMs, now);
    const bucket = { count: next.count, resetAt: next.resetAt };
    if (next.fresh) this.buckets.delete(key); // ny insättningsordning = "nyast"
    this.buckets.set(key, bucket);
    return bucket;
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    // Städa utgångna nycklar regelbundet (inte bara när kartan redan är stor).
    if (++this.writesSinceSweep >= SWEEP_EVERY || this.buckets.size >= this.maxBuckets) {
      this.writesSinceSweep = 0;
      for (const [key, b] of this.buckets) {
        if (b.resetAt <= now) this.buckets.delete(key);
      }
    }
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/**
 * Pseudonym för en rate-limit-nyckel i det delade lagret. HMAC-SHA256 med en
 * server-hemlighet när en sådan finns (IPv4-rymden är liten — en osaltad
 * SHA-256 av en IP går att räkna baklänges), annars SHA-256 med
 * domänseparation. Alla containrar läser samma env → samma hash.
 * Resultatet är 64 hex-tecken (ryms i `rate_limits.key`, max 200).
 */
export function hashRateLimitKey(key: string, secret?: string | null): string {
  const material = `movexum-rl:v1:${key}`;
  if (secret && secret.length > 0) {
    return createHmac('sha256', secret).update(material).digest('hex');
  }
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Enkel brytare: efter ett fel mot det delade lagret används bara
 * processminnet i `cooldownMs`, så en nere PocketBase inte lägger en
 * timeout på varje inloggning. Ren — tiden injiceras.
 */
export class SharedStoreBreaker {
  private openUntil = 0;
  private readonly cooldownMs: number;

  constructor(cooldownMs: number = 30_000) {
    this.cooldownMs = cooldownMs;
  }

  isOpen(now: number): boolean {
    return now < this.openUntil;
  }

  trip(now: number): void {
    this.openUntil = now + this.cooldownMs;
  }

  reset(): void {
    this.openUntil = 0;
  }
}

/** Parsar PocketBase-datum ("2026-10-08 12:00:00.000Z") till epoch-ms; NaN → null. */
export function parsePbDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value.trim().replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

/** Epoch-ms → ISO-sträng som PocketBase accepterar i ett date-fält. */
export function toPbDate(ms: number): string {
  return new Date(ms).toISOString();
}

/* ── Delat lager (algoritm med injicerat lager, testbar utan PocketBase) ── */

export interface SharedRateLimitRow {
  id: string;
  count: number;
  resetAt: number;
}

/**
 * Det IO-skalet implementerar mot `rate_limits`. `hash` är ALDRIG
 * klartextnyckeln (se `hashRateLimitKey`).
 */
export interface SharedRateLimitStore {
  find(hash: string): Promise<SharedRateLimitRow | null>;
  /** 'conflict' = unik-indexet på `key` sa nej (någon annan hann före). */
  create(hash: string, count: number, resetAt: number): Promise<'created' | 'conflict'>;
  /** Atomär uppräkning; returnerar det nya värdet. */
  increment(row: SharedRateLimitRow): Promise<number>;
  set(id: string, count: number, resetAt: number): Promise<void>;
  remove(id: string): Promise<void>;
}

export async function sharedCheck(
  store: SharedRateLimitStore,
  hash: string,
  max: number,
  now: number
): Promise<RateLimitResult> {
  const row = await store.find(hash);
  return evaluateBucket(row, max, now);
}

/**
 * Registrera ett försök i det delade lagret. Skapandet är idempotent mot
 * unik-indexet: krockar två containrar på första försöket görs ett nytt varv
 * som räknar upp den rad som vann. Kastar vid lagerfel (anroparen faller då
 * tillbaka på processminnet).
 */
export async function sharedRecord(
  store: SharedRateLimitStore,
  hash: string,
  windowMs: number,
  now: number
): Promise<RateLimitBucket> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.find(hash);
    if (!row) {
      const next = nextBucket(null, windowMs, now);
      const created = await store.create(hash, next.count, next.resetAt);
      if (created === 'created') return { count: next.count, resetAt: next.resetAt };
      continue; // någon annan skapade raden samtidigt — räkna upp den i nästa varv
    }
    if (row.resetAt <= now) {
      const next = nextBucket(null, windowMs, now);
      await store.set(row.id, next.count, next.resetAt);
      return { count: next.count, resetAt: next.resetAt };
    }
    const count = await store.increment(row);
    return { count, resetAt: row.resetAt };
  }
  throw new Error('rate-limit: raden kunde varken skapas eller läsas');
}

export async function sharedClear(store: SharedRateLimitStore, hash: string): Promise<void> {
  const row = await store.find(hash);
  if (row) await store.remove(row.id);
}
