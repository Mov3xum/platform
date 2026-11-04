import 'server-only';
import type PocketBase from 'pocketbase';
import { emptyUserActivity, type UserActivityStats } from '@platform/shared';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { statsFromRow } from './record.server';

/**
 * Läsvägar för användaraktivitet (CLAUDE.md § 57). Läser med användarens egen
 * token så RLS gäller: ledningen ser tenantens rader, var och en sin egen.
 * Superuser BARA som reserv vid PB v0.23.4:s tysta regel-nekande (§ 21.3) —
 * och då med tenant-filtret satt server-side från sessionen.
 */

const COLLECTION = 'user_activity';
const ROW_FIELDS = 'id,user,tenant,first_login_at,last_login_at,login_count,last_seen_at,last_module,modules,active_days';
const PAGE = 500;

interface Row {
  id: string;
  user: string;
  tenant: string;
  first_login_at?: string;
  last_login_at?: string;
  login_count?: number;
  last_seen_at?: string;
  last_module?: string;
  modules?: unknown;
  active_days?: unknown;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export interface TenantActivityResult {
  /** user-id → aktivitet. Användare utan rad saknas i kartan (= aldrig inloggad). */
  byUser: Map<string, UserActivityStats>;
  /** Sant när kollektionen inte finns (migration 1700000209 ej körd) eller läsningen föll. */
  unavailable: boolean;
}

async function listAll(pb: PocketBase, filter: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await pb.collection(COLLECTION).getList<Row>(page, PAGE, { filter, fields: ROW_FIELDS });
    out.push(...res.items);
    if (res.items.length < PAGE || out.length >= res.totalItems) break;
  }
  return out;
}

/** Hela tenantens aktivitet (ledningen). Fail-soft: tom karta + `unavailable`. */
export async function loadTenantActivity(pb: PocketBase, tenant: string): Promise<TenantActivityResult> {
  const filter = `tenant = "${escFilter(tenant)}"`;
  const toMap = (rows: Row[]) => {
    const byUser = new Map<string, UserActivityStats>();
    for (const r of rows) {
      if (r.tenant !== tenant) continue;
      byUser.set(r.user, statsFromRow(r));
    }
    return byUser;
  };
  try {
    return { byUser: toMap(await listAll(pb, filter)), unavailable: false };
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403 || status === 404) {
      const su = await getSuperuserPb();
      if (su.ok) {
        try {
          return { byUser: toMap(await listAll(su.pb, filter)), unavailable: false };
        } catch (inner) {
          console.warn('[user-activity] läsning (superuser) föll', { status: statusOf(inner) });
        }
      }
    } else {
      console.warn('[user-activity] läsning föll', { status });
    }
    return { byUser: new Map(), unavailable: true };
  }
}

/** Den inloggades egen rad (Mitt konto). Fail-soft: tom aktivitet. */
export async function loadMyActivity(pb: PocketBase, userId: string): Promise<UserActivityStats> {
  try {
    const row = await pb
      .collection(COLLECTION)
      .getFirstListItem<Row>(pb.filter('user = {:u}', { u: userId }), { fields: ROW_FIELDS });
    return statsFromRow(row);
  } catch (err) {
    const status = statusOf(err);
    if (status !== 404) console.warn('[user-activity] egen läsning föll', { status });
    return emptyUserActivity();
  }
}
