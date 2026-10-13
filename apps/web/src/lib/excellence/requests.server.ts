import 'server-only';
import type PocketBase from 'pocketbase';
import {
  normalizeScreeningRequestItems,
  type ScreeningRequestItem,
  type ScreeningRequestRecipient,
  type ScreeningRequestStatus
} from '@platform/shared';
import { pbStatus } from '@/lib/pb-error';

// Läsvägen för begäran om komplettering (CLAUDE.md § 51.6). Reads med
// användarens token → RLS: staff/observer ser tenantens förfrågningar, en
// bolagsmedlem BARA förfrågningar ställda till sitt bolag
// (`recipient_kind = "startup"`). Tenant verifieras dessutom i koden.

export const SCREENING_REQUESTS = 'screening_requests';

export interface ScreeningRequestRow {
  id: string;
  tenant: string;
  startup: string;
  startup_name?: string;
  screening?: string;
  requested_by?: string;
  requested_by_name?: string;
  recipient_kind: ScreeningRequestRecipient;
  recipient?: string;
  recipient_name?: string;
  message?: string;
  items: ScreeningRequestItem[];
  status: ScreeningRequestStatus;
  due_at?: string;
  answered_at?: string;
  closed_at?: string;
  created: string;
  updated: string;
}

interface RawRow {
  id: string;
  tenant?: string;
  startup?: string;
  screening?: string;
  requested_by?: string;
  recipient_kind?: string;
  recipient?: string;
  message?: string;
  items?: unknown;
  status?: string;
  due_at?: string;
  answered_at?: string;
  closed_at?: string;
  created?: string;
  updated?: string;
  expand?: {
    startup?: { name?: string };
    requested_by?: { display_name?: string };
    recipient?: { display_name?: string };
  };
}

const STATUSES: readonly ScreeningRequestStatus[] = ['open', 'partially_answered', 'answered', 'closed'];
const FIELDS =
  'id,tenant,startup,screening,requested_by,recipient_kind,recipient,message,items,status,due_at,answered_at,closed_at,created,updated,expand.startup.name,expand.requested_by.display_name,expand.recipient.display_name';

function nameOf(u: { display_name?: string } | undefined): string | undefined {
  const n = (u?.display_name || '').trim();
  return n && !n.includes('@') ? n : undefined;
}

export function mapScreeningRequestRow(r: RawRow): ScreeningRequestRow | null {
  if (!r.tenant || !r.startup) return null;
  const kind = r.recipient_kind === 'coach' ? 'coach' : r.recipient_kind === 'startup' ? 'startup' : null;
  if (!kind) return null;
  return {
    id: r.id,
    tenant: r.tenant,
    startup: r.startup,
    startup_name: r.expand?.startup?.name || undefined,
    screening: r.screening || undefined,
    requested_by: r.requested_by || undefined,
    requested_by_name: nameOf(r.expand?.requested_by),
    recipient_kind: kind,
    recipient: r.recipient || undefined,
    recipient_name: nameOf(r.expand?.recipient),
    message: r.message || undefined,
    items: normalizeScreeningRequestItems(r.items),
    status: STATUSES.find((s) => s === r.status) ?? 'open',
    due_at: r.due_at || undefined,
    answered_at: r.answered_at || undefined,
    closed_at: r.closed_at || undefined,
    created: r.created || '',
    updated: r.updated || ''
  };
}

/** Förfrågningar för ett bolag, nyast först (RLS). Fail-soft. */
export async function listScreeningRequestsForStartup(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  opts: { openOnly?: boolean; limit?: number } = {}
): Promise<{ requests: ScreeningRequestRow[]; error?: string }> {
  try {
    const filter = opts.openOnly
      ? pb.filter('tenant = {:t} && startup = {:s} && status != "closed"', { t: tenantId, s: startupId })
      : pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId });
    const res = await pb.collection(SCREENING_REQUESTS).getList<RawRow>(1, Math.min(opts.limit ?? 20, 100), {
      filter,
      sort: '-created',
      expand: 'startup,requested_by,recipient',
      fields: FIELDS
    });
    return { requests: res.items.map(mapScreeningRequestRow).filter((r): r is ScreeningRequestRow => !!r && r.tenant === tenantId) };
  } catch (err) {
    if (pbStatus(err) === 404) return { requests: [], error: 'Kollektionen screening_requests saknas — kör migration 1700000191.' };
    return { requests: [], error: 'Kompletteringarna kunde inte läsas just nu.' };
  }
}

/** Öppna förfrågningar ställda till en viss kollega (coach) — "mina att svara på". */
export async function listScreeningRequestsForRecipient(
  pb: PocketBase,
  tenantId: string,
  userId: string,
  limit = 20
): Promise<ScreeningRequestRow[]> {
  try {
    const res = await pb.collection(SCREENING_REQUESTS).getList<RawRow>(1, Math.min(limit, 100), {
      filter: pb.filter('tenant = {:t} && recipient = {:u} && status != "closed"', { t: tenantId, u: userId }),
      sort: '-created',
      expand: 'startup,requested_by,recipient',
      fields: FIELDS
    });
    return res.items.map(mapScreeningRequestRow).filter((r): r is ScreeningRequestRow => !!r && r.tenant === tenantId);
  } catch {
    return [];
  }
}

/** En förfrågan (RLS), tenant-verifierad i koden. */
export async function getScreeningRequest(pb: PocketBase, tenantId: string, id: string): Promise<ScreeningRequestRow | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const r = await pb.collection(SCREENING_REQUESTS).getOne<RawRow>(id, { expand: 'startup,requested_by,recipient', fields: FIELDS });
    const row = mapScreeningRequestRow(r);
    return row && row.tenant === tenantId ? row : null;
  } catch {
    return null;
  }
}
