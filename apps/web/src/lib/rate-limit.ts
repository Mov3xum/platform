import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  MemoryRateLimiter,
  SharedStoreBreaker,
  hashRateLimitKey,
  parsePbDate,
  sharedCheck,
  sharedClear,
  sharedRecord,
  toPbDate,
  type RateLimitResult,
  type SharedRateLimitRow,
  type SharedRateLimitStore
} from './rate-limit-core';

export type { RateLimitResult } from './rate-limit-core';

/**
 * Rate limiter för brute-force-/missbruksskydd (login, återställning, röst,
 * publika intag-/enkätroutar, uppladdningar m.fl.).
 *
 * **Delad mellan containrar (CLAUDE.md § 21.8).** Räknarna lever i
 * PocketBase-kollektionen `rate_limits` (migration 1700000184, alla
 * API-regler null = bara superuser) via den cachade superuser-klienten, så
 * en gräns gäller över ALLA web-containrar bakom lastbalanseraren.
 * Nyckeln lagras bara som HMAC/SHA-256 (`hashRateLimitKey`) — aldrig e-post
 * eller IP i klartext (GDPR § 5).
 *
 * **Fail-open men aldrig utan gräns.** Saknas superuser-credentials, saknas
 * kollektionen (migrationen inte körd) eller svarar PB med fel används den
 * gamla in-memory-limitern för den containern, och en brytare håller det
 * delade lagret avstängt i 30 s så en nere PB inte lägger latens på varje
 * anrop. En begäran blockeras aldrig för att PB är nere — men
 * processminnets gräns gäller fortfarande. Processminnet räknas ALLTID med
 * (billigt första filter + varm reserv).
 *
 * Endast det anroparen registrerar räknas: `recordFailure` ökar räknaren,
 * `clearFailures` nollställer den (t.ex. vid lyckad inloggning).
 */

const COLLECTION = 'rate_limits';

const memory = new MemoryRateLimiter();
const breaker = new SharedStoreBreaker(30_000);

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  if (statusOf(err) !== 400) return false;
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data;
  return data?.key?.code === 'validation_not_unique';
}

let warned = false;
/** PII-fri logg, en gång per process tills det delade lagret fungerar igen. */
function noteFallback(reason: string, err?: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('[rate-limit] delat lager otillgängligt — använder processminnet', {
    reason,
    status: statusOf(err)
  });
}

function noteRecovered(): void {
  if (warned) {
    warned = false;
    console.info('[rate-limit] delat lager tillgängligt igen');
  }
}

function secret(): string | undefined {
  return process.env.MOVEXUM_RATE_LIMIT_SECRET || process.env.MOVEXUM_INTEGRATION_KEY || undefined;
}

function toRow(rec: Record<string, unknown>): SharedRateLimitRow | null {
  const resetAt = parsePbDate(rec.reset_at);
  if (resetAt === null) return null;
  const count = typeof rec.count === 'number' ? rec.count : Number(rec.count) || 0;
  return { id: String(rec.id), count, resetAt };
}

function pbStore(pb: PocketBase): SharedRateLimitStore {
  const col = () => pb.collection(COLLECTION);
  return {
    async find(hash) {
      const res = await col().getList(1, 1, {
        filter: pb.filter('key = {:k}', { k: hash }),
        fields: 'id,count,reset_at'
      });
      const rec = res.items[0];
      if (!rec) return null;
      const row = toRow(rec);
      // En rad utan giltigt datum behandlas som utgången (räknas om från 1).
      return row ?? { id: String(rec.id), count: 0, resetAt: 0 };
    },
    async create(hash, count, resetAt) {
      try {
        await col().create({ key: hash, count, reset_at: toPbDate(resetAt) });
        return 'created';
      } catch (err) {
        if (isUniqueViolation(err)) return 'conflict';
        throw err;
      }
    },
    async increment(row) {
      // `count+` är PB:s atomära modifierare för talfält. Skulle instansen
      // inte stödja den (fältet släpps tyst) sätter vi värdet explicit.
      const updated = await col().update(row.id, { 'count+': 1 }, { fields: 'id,count' });
      const next = typeof updated.count === 'number' ? updated.count : Number(updated.count);
      if (Number.isFinite(next) && next > row.count) return next;
      const fallback = row.count + 1;
      await col().update(row.id, { count: fallback }, { fields: 'id' });
      return fallback;
    },
    async set(id, count, resetAt) {
      await col().update(id, { count, reset_at: toPbDate(resetAt) }, { fields: 'id' });
    },
    async remove(id) {
      try {
        await col().delete(id);
      } catch (err) {
        if (statusOf(err) !== 404) throw err;
      }
    }
  };
}

/** Det delade lagret, eller null när det inte ska/kan användas just nu. */
async function sharedStore(now: number): Promise<SharedRateLimitStore | null> {
  if (breaker.isOpen(now)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) {
    breaker.trip(now);
    noteFallback(su.reason);
    return null;
  }
  return pbStore(su.pb);
}

function failShared(err: unknown, now: number): void {
  breaker.trip(now);
  noteFallback('pb_error', err);
}

// Städning av utgångna rader i det delade lagret (opportunistisk, ingen cron).
const SHARED_SWEEP_EVERY = 200;
let recordsSinceSharedSweep = 0;

async function maybeSweepShared(now: number): Promise<void> {
  if (++recordsSinceSharedSweep < SHARED_SWEEP_EVERY) return;
  recordsSinceSharedSweep = 0;
  const su = await getSuperuserPb();
  if (!su.ok) return;
  try {
    const res = await su.pb.collection(COLLECTION).getList(1, 100, {
      filter: su.pb.filter('reset_at < {:now}', { now: toPbDate(now) }),
      fields: 'id'
    });
    for (const rec of res.items) {
      try {
        await su.pb.collection(COLLECTION).delete(rec.id);
      } catch {
        // best-effort — en parallell städning kan ha tagit raden
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Är nyckeln blockerad (≥ `max` registrerade försök i ett aktivt fönster)?
 * Processminnet prövas först; blockerar det behövs inget PB-anrop.
 */
export async function checkRateLimit(key: string, max: number): Promise<RateLimitResult> {
  const now = Date.now();
  const local = memory.check(key, max, now);
  if (local.blocked) return local;
  const store = await sharedStore(now);
  if (!store) return local;
  try {
    const result = await sharedCheck(store, hashRateLimitKey(key, secret()), max, now);
    noteRecovered();
    return result;
  } catch (err) {
    failShared(err, now);
    return local;
  }
}

/** Registrera ett försök (startar ett fönster om `windowMs` vid behov). */
export async function recordFailure(key: string, windowMs: number): Promise<void> {
  const now = Date.now();
  memory.record(key, windowMs, now);
  const store = await sharedStore(now);
  if (!store) return;
  try {
    await sharedRecord(store, hashRateLimitKey(key, secret()), windowMs, now);
    noteRecovered();
  } catch (err) {
    failShared(err, now);
    return;
  }
  void maybeSweepShared(now);
}

/** Nollställ nyckeln (t.ex. efter lyckad inloggning). */
export async function clearFailures(key: string): Promise<void> {
  const now = Date.now();
  memory.clear(key);
  const store = await sharedStore(now);
  if (!store) return;
  try {
    await sharedClear(store, hashRateLimitKey(key, secret()));
  } catch (err) {
    failShared(err, now);
  }
}
