/**
 * Ren, enhetstestad kärna för det distribuerade låset (`distributed-lock.ts`).
 *
 * Ingen PocketBase, inga `@/`-importer, inget `server-only`. IO-skalet
 * kopplar in `app_locks` (migration 1700000184) som `LockStore`; testerna
 * använder ett minneslager.
 *
 * Modellen: ett lås = en rad med unik `key`. Att skapa raden ÄR att ta
 * låset (unik-indexet avgör vem som vann). En rad vars `expiresAt` passerat
 * är övergiven (containern dog mitt i) och får raderas av nästa som vill ha
 * låset. Släpp raderar raden — bara om ägaren fortfarande är vi.
 */

export interface LockRow {
  id: string;
  owner: string;
  /** Epoch-ms. */
  expiresAt: number;
}

export interface LockStore {
  /** 'held' = unik-indexet sa nej (någon annan håller låset). */
  tryCreate(key: string, owner: string, expiresAt: number): Promise<'acquired' | 'held'>;
  get(key: string): Promise<LockRow | null>;
  remove(id: string): Promise<void>;
}

export interface LockTiming {
  ttlMs: number;
  waitMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** [0, 1) — injiceras för deterministiska tester. */
  random: () => number;
}

export const DEFAULT_LOCK_TTL_MS = 15_000;
export const DEFAULT_LOCK_WAIT_MS = 10_000;
export const MAX_LOCK_KEY_LENGTH = 200;

const BACKOFF_BASE_MS = 25;
const BACKOFF_CAP_MS = 500;

/** Kastas när låset inte kunde tas inom `waitMs` (någon annan håller det). */
export class LockTimeoutError extends Error {
  readonly code = 'LOCK_TIMEOUT';
  constructor(key: string) {
    super(`Låset "${key}" är upptaget — försök igen om en stund.`);
    this.name = 'LockTimeoutError';
  }
}

export function assertLockKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_LOCK_KEY_LENGTH) {
    throw new Error(`Ogiltig låsnyckel (1–${MAX_LOCK_KEY_LENGTH} tecken).`);
  }
}

/**
 * Exponentiell backoff med jitter ("equal jitter"): halva fördröjningen är
 * fast, halva slumpad, så samtidiga väntare inte försöker i takt.
 */
export function lockBackoffMs(attempt: number, random: () => number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(attempt, 10)));
  const half = exp / 2;
  return Math.round(half + random() * half);
}

/**
 * Ta låset. Returnerar när raden är vår; kastar `LockTimeoutError` efter
 * `waitMs`. Lagerfel (PB nere m.m.) bubblar — anroparen avgör reserven.
 */
export async function acquireLock(
  store: LockStore,
  key: string,
  owner: string,
  timing: LockTiming
): Promise<void> {
  assertLockKey(key);
  const deadline = timing.now() + Math.max(0, timing.waitMs);
  let waits = 0;
  // Snabba omförsök (låset släpptes/städades just) utan paus — men högst
  // några i rad, så ett lager som säger "upptaget" utan att visa raden
  // aldrig ger en tight loop.
  let fastRetries = 0;
  for (;;) {
    const now = timing.now();
    const result = await store.tryCreate(key, owner, now + Math.max(1, timing.ttlMs));
    if (result === 'acquired') return;

    const existing = await store.get(key);
    if (!existing || existing.expiresAt <= timing.now()) {
      // Släpptes mellan försöken, eller övergivet lås (ägaren dog/överskred
      // TTL) — städa och försök igen direkt.
      if (existing) await store.remove(existing.id);
      if (++fastRetries <= 3) continue;
    }

    if (timing.now() >= deadline) throw new LockTimeoutError(key);
    fastRetries = 0;
    const delay = Math.min(lockBackoffMs(waits++, timing.random), Math.max(1, deadline - timing.now()));
    await timing.sleep(delay);
  }
}

/** Släpp låset — raderar raden BARA om vi fortfarande äger den. */
export async function releaseLock(store: LockStore, key: string, owner: string): Promise<boolean> {
  const existing = await store.get(key);
  if (!existing || existing.owner !== owner) return false;
  await store.remove(existing.id);
  return true;
}

/**
 * In-process-mutex per nyckel (kedja av promises). Ligger FRAMFÖR det
 * distribuerade låset så att en enskild container inte hamrar PB med
 * konkurrerande försök, och är hela låset när PB inte går att nå.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  get size(): number {
    return this.chains.size;
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.chains.set(key, next);
    try {
      return await next;
    } finally {
      if (this.chains.get(key) === next) this.chains.delete(key);
    }
  }
}
