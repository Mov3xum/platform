import 'server-only';
import type PocketBase from 'pocketbase';
import {
  canViewScreeningRequest,
  normalizeScreeningRequestItems,
  type ScreeningRequestItem,
  type ScreeningRequestRecipient,
  type ScreeningRequestStatus,
  type ScreeningRequestViewer
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { pbStatus } from '@/lib/pb-error';
import { isRuleDenialStatus } from '@/lib/read-scaling';

// Läsvägen för begäran om komplettering (CLAUDE.md § 51.6). Reads med
// användarens token FÖRST → RLS: staff/observer ser tenantens förfrågningar,
// en bolagsmedlem BARA förfrågningar ställda till sitt bolag
// (`recipient_kind = "startup"`).
//
// Incident 2026-10-14: notisen "Begäran om komplettering" gick inte att
// öppna — PocketBase 0.23.4 nekade tyst view-regeln för en behörig coach
// (§ 21.3), `getOne` svarade 404 och `/komplettering/<id>` gav "sidan finns
// inte". Skrivlagret hade redan superuser-reserven (`getRecordInTenant`),
// läsvägen inte. Nu faller varje läsning tillbaka på den cachade superusern
// vid regel-nekande (400/403/404, eller ett TOMT listsvar — en tyst nekad
// list-regel ger 200 med noll rader) och **behörigheten prövas i koden**
// med `canViewScreeningRequest` — exakt samma villkor som list/viewRule.
// Reserven är robusthet, inte behörighet: en rad läsaren inte får se
// returneras aldrig, oavsett vilken klient som läste den.

export const SCREENING_REQUESTS = 'screening_requests';
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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

type Viewer = ScreeningRequestViewer;

/** Superuser-reserv vid PB 0.23.4:s tysta regel-nekande; null när ingen finns. */
async function superuserClient(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  return su.ok ? su.pb : null;
}

function visibleRows(viewer: Viewer, rows: RawRow[]): ScreeningRequestRow[] {
  return rows
    .map(mapScreeningRequestRow)
    .filter((r): r is ScreeningRequestRow => !!r && canViewScreeningRequest(viewer, r));
}

/**
 * Lista med användartoken; vid regel-nekande ELLER tomt svar läses samma
 * filter som superuser och raderna filtreras i koden (`canViewScreeningRequest`).
 * Ett tomt svar måste trigga reserven: en tyst nekad list-regel ger 200 med
 * noll rader, inte ett fel (§ 21.8). En legitimt tom lista kostar därmed en
 * indexerad superuser-läsning av samma (små) filter.
 */
async function listWithFallback(
  pb: PocketBase,
  viewer: Viewer,
  filter: string,
  limit: number
): Promise<{ requests: ScreeningRequestRow[]; error?: string }> {
  const read = (client: PocketBase) =>
    client.collection(SCREENING_REQUESTS).getList<RawRow>(1, Math.min(limit, 100), {
      filter,
      sort: '-created',
      expand: 'startup,requested_by,recipient',
      fields: FIELDS
    });
  let primary: RawRow[] | null = null;
  try {
    primary = (await read(pb)).items;
    if (primary.length > 0) return { requests: visibleRows(viewer, primary) };
  } catch (err) {
    const status = pbStatus(err);
    if (status === 404) return { requests: [], error: 'Kollektionen screening_requests saknas — kör migration 1700000191.' };
    if (!isRuleDenialStatus(status)) return { requests: [], error: 'Kompletteringarna kunde inte läsas just nu.' };
  }
  const su = await superuserClient();
  if (su) {
    try {
      return { requests: visibleRows(viewer, (await read(su)).items) };
    } catch (err) {
      if (pbStatus(err) === 404) return { requests: [], error: 'Kollektionen screening_requests saknas — kör migration 1700000191.' };
    }
  }
  if (primary !== null) return { requests: [] };
  return { requests: [], error: 'Kompletteringarna kunde inte läsas just nu.' };
}

/** Förfrågningar för ett bolag, nyast först. Fail-soft. */
export async function listScreeningRequestsForStartup(
  pb: PocketBase,
  viewer: Viewer,
  startupId: string,
  opts: { openOnly?: boolean; limit?: number } = {}
): Promise<{ requests: ScreeningRequestRow[]; error?: string }> {
  if (!ID_RE.test(startupId)) return { requests: [] };
  const filter = opts.openOnly
    ? pb.filter('tenant = {:t} && startup = {:s} && status != "closed"', { t: viewer.tenant, s: startupId })
    : pb.filter('tenant = {:t} && startup = {:s}', { t: viewer.tenant, s: startupId });
  return listWithFallback(pb, viewer, filter, opts.limit ?? 20);
}

/** Öppna förfrågningar ställda till en viss kollega (coach) — "mina att svara på". */
export async function listScreeningRequestsForRecipient(
  pb: PocketBase,
  viewer: Viewer,
  userId: string,
  limit = 20
): Promise<ScreeningRequestRow[]> {
  if (!ID_RE.test(userId)) return [];
  const filter = pb.filter('tenant = {:t} && recipient = {:u} && status != "closed"', { t: viewer.tenant, u: userId });
  return (await listWithFallback(pb, viewer, filter, limit)).requests;
}

/**
 * En förfrågan: användartoken → superuser-reserv vid regel-nekande →
 * behörighet prövad i koden. null = finns inte ELLER får inte ses.
 */
export async function getScreeningRequest(pb: PocketBase, viewer: Viewer, id: string): Promise<ScreeningRequestRow | null> {
  if (!ID_RE.test(id)) return null;
  const read = (client: PocketBase) =>
    client.collection(SCREENING_REQUESTS).getOne<RawRow>(id, { expand: 'startup,requested_by,recipient', fields: FIELDS });
  let raw: RawRow | null = null;
  try {
    raw = await read(pb);
  } catch (err) {
    if (!isRuleDenialStatus(pbStatus(err))) return null;
    const su = await superuserClient();
    if (!su) return null;
    try {
      raw = await read(su);
    } catch {
      return null;
    }
  }
  const row = raw ? mapScreeningRequestRow(raw) : null;
  return row && canViewScreeningRequest(viewer, row) ? row : null;
}
