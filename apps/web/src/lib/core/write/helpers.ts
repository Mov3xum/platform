import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type { Actor } from './types';

/**
 * Delade robusthetshjälpare för skrivlagret (§ 16, § 33).
 *
 * `writeWithFallback`: skriv via användarens token först; falla tillbaka på
 * superuser vid 400/403 (PB v0.23.4:s rule-eval-bugg, § 21.3 — samma mönster
 * som `lib/core/write/compass.ts` och `lib/actions/workshops.ts`). Roll +
 * tenant är ALLTID verifierade av anroparen innan fallbacken används —
 * superusern är en robusthetsfallback, inte behörighetsgränsen.
 *
 * `getRecordInTenant`: läs en rad och verifiera att den tillhör actorns
 * tenant. Läsningen provas först med användarens token (RLS), sedan superuser
 * (en trasig view-regel får inte blockera en behörig skrivning) — men
 * tenant-kontrollen i koden är den faktiska gränsen.
 */

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

export async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

export async function getRecordInTenant<T extends { id: string; tenant?: string }>(
  pb: PocketBase,
  actor: Actor,
  collection: string,
  id: string,
  fields: string
): Promise<T | null> {
  const read = async (client: PocketBase): Promise<T | null> => {
    try {
      return await client.collection(collection).getOne<T>(id, { fields });
    } catch {
      return null;
    }
  };
  let row = await read(pb);
  if (!row) {
    const su = await getSuperuserPb();
    if (su.ok) row = await read(su.pb);
  }
  if (!row) return null;
  if (String(row.tenant ?? '') !== actor.tenant) return null;
  return row;
}
