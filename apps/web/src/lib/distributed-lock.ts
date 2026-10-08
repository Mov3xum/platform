import 'server-only';
import { randomUUID } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_LOCK_WAIT_MS,
  KeyedMutex,
  LockTimeoutError,
  acquireLock,
  assertLockKey,
  releaseLock,
  type LockStore
} from './distributed-lock-core';
import { parsePbDate, toPbDate } from './rate-limit-core';

export { LockTimeoutError } from './distributed-lock-core';

/**
 * Distribuerat lås över alla web-containrar (CLAUDE.md § 21.8).
 *
 * `withDistributedLock(key, fn)` kör `fn` med ensamrätt på `key` i HELA
 * driftmiljön, inte bara i den här processen: låset är en rad i
 * PocketBase-kollektionen `app_locks` (migration 1700000184, alla
 * API-regler null = bara superuser) med unikt index på `key`.
 *
 * - En in-process-mutex ligger framför, så samma container köar sina egna
 *   anrop lokalt och bara ETT försök i taget når PB.
 * - Ett lås som inte släppts (container dog) går ut efter `ttlMs` och städas
 *   av nästa som vill ha det. `fn` ska vara kort — längre än `ttlMs` och
 *   någon annan kan ta låset.
 * - Saknas superuser-credentials, saknas kollektionen eller svarar PB med
 *   fel faller vi tillbaka på enbart in-process-mutexen (samma skydd som
 *   före horisontell skalning) och loggar en gång, PII-fritt.
 * - Håller en ANNAN container låset längre än `waitMs` kastas
 *   `LockTimeoutError` — hellre ett tydligt fel än en tyst krock.
 *
 * Nycklar är interna identifierare (t.ex. `compass_module:<id>`) och får
 * inte bära personuppgifter.
 */

const COLLECTION = 'app_locks';
const PROCESS_ID = randomUUID();

const mutex = new KeyedMutex();

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
function noteFallback(reason: string, err?: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('[distributed-lock] delat lager otillgängligt — använder bara in-process-lås', {
    reason,
    status: statusOf(err)
  });
}

function pbLockStore(pb: PocketBase): LockStore {
  const col = () => pb.collection(COLLECTION);
  return {
    async tryCreate(key, owner, expiresAt) {
      try {
        await col().create({ key, owner, expires_at: toPbDate(expiresAt) }, { fields: 'id' });
        return 'acquired';
      } catch (err) {
        if (isUniqueViolation(err)) return 'held';
        throw err;
      }
    },
    async get(key) {
      const res = await col().getList(1, 1, {
        filter: pb.filter('key = {:k}', { k: key }),
        fields: 'id,owner,expires_at'
      });
      const rec = res.items[0];
      if (!rec) return null;
      // Ett oläsbart datum behandlas som utgånget (städas).
      return {
        id: String(rec.id),
        owner: String(rec.owner ?? ''),
        expiresAt: parsePbDate(rec.expires_at) ?? 0
      };
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

const realTiming = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random()
};

export interface DistributedLockOptions {
  /** Hur länge låset gäller innan det räknas som övergivet (default 15 s). */
  ttlMs?: number;
  /** Hur länge vi väntar på en annan container innan LockTimeoutError (default 10 s). */
  waitMs?: number;
}

export async function withDistributedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: DistributedLockOptions = {}
): Promise<T> {
  assertLockKey(key);
  const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;

  return mutex.run(key, async () => {
    const su = await getSuperuserPb();
    if (!su.ok) {
      noteFallback(su.reason);
      return fn();
    }
    const store = pbLockStore(su.pb);
    const owner = `${PROCESS_ID}:${randomUUID()}`;

    try {
      await acquireLock(store, key, owner, { ttlMs, waitMs, ...realTiming });
    } catch (err) {
      if (err instanceof LockTimeoutError) throw err;
      // PB nere / kollektionen saknas — in-process-mutexen är reserven.
      noteFallback('pb_error', err);
      return fn();
    }
    if (warned) {
      warned = false;
      console.info('[distributed-lock] delat lager tillgängligt igen');
    }

    try {
      return await fn();
    } finally {
      try {
        await releaseLock(store, key, owner);
      } catch (err) {
        // Raden går ut av sig själv efter ttlMs — logga men fäll inte anropet.
        console.warn('[distributed-lock] kunde inte släppa låset', { status: statusOf(err) });
      }
    }
  });
}
