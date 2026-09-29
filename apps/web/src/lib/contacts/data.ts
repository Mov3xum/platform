import 'server-only';
import type PocketBase from 'pocketbase';
import {
  CONTACT_BOOK_ROLES,
  contactDisplayName,
  isContactCategory,
  isContactRequestStatus,
  type ContactCategory,
  type ContactRequestStatus,
  type Role
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { escFilter } from '@/lib/pb-filter';

/**
 * Enda läsvägen för kontaktboken (CLAUDE.md § 41). Reads går via den
 * inkommande klienten (användarens token → RLS § 21: `contacts` och
 * `contact_requests` är staff/observer-only). Fail-soft mot ett ännu inte
 * migrerat schema (tom lista, aldrig krasch). Kollektionerna adresseras på
 * NAMN (§ 30.4 p. 1).
 *
 * Undantaget är `listSharedContactsForStartup`, som körs som superuser EFTER
 * att anroparen verifierat att den inloggade är medlem i bolaget — det är den
 * kurerade vyn som låter ett bolag se de kontakter som DELATS med det via en
 * godkänd förfrågan (§ 41.4), utan att öppna kontaktboken för medlemmar.
 */

export const CONTACTS = 'contacts';
export const CONTACT_REQUESTS = 'contact_requests';
export const STARTUP_CONTACTS = 'startup_contacts';

export interface ContactRow {
  id: string;
  tenant: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  primary_role: string | null;
  category: ContactCategory | null;
  kommun: string | null;
  skills: string | null;
  info: string | null;
  gdpr_consent: boolean;
  gdpr_consent_at: string | null;
  owners: string[];
  created_by: string | null;
  created?: string;
  updated?: string;
}

export interface ContactRequestRow {
  id: string;
  tenant: string;
  contact: string;
  requester: string;
  owners: string[];
  purpose: string;
  startup: string | null;
  startup_role: string | null;
  status: ContactRequestStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created?: string;
  updated?: string;
  expand?: {
    contact?: Partial<ContactRow> & { id: string };
    startup?: { id: string; name?: string };
    requester?: { id: string; display_name?: string; email?: string };
    decided_by?: { id: string; display_name?: string; email?: string };
  };
}

export interface StartupLinkRow {
  id: string;
  startup: string;
  contact: string;
  role: string | null;
  is_primary: boolean;
  expand?: {
    startup?: { id: string; name?: string; status?: string };
    contact?: Partial<ContactRow> & { id: string };
  };
}

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  roles: Role[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function ids(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (typeof v === 'string' && v) return [v];
  return [];
}

export function normalizeContact(raw: Record<string, unknown>): ContactRow {
  const category = raw.category;
  return {
    id: String(raw.id),
    tenant: String(raw.tenant ?? ''),
    first_name: typeof raw.first_name === 'string' ? raw.first_name : '',
    last_name: typeof raw.last_name === 'string' ? raw.last_name : '',
    email: str(raw.email),
    phone: str(raw.phone),
    organization: str(raw.organization),
    primary_role: str(raw.primary_role),
    category: isContactCategory(category) ? category : null,
    kommun: str(raw.kommun),
    skills: str(raw.skills),
    info: str(raw.info),
    gdpr_consent: raw.gdpr_consent === true,
    gdpr_consent_at: str(raw.gdpr_consent_at),
    owners: ids(raw.owners),
    created_by: str(raw.created_by),
    created: str(raw.created) ?? undefined,
    updated: str(raw.updated) ?? undefined
  };
}

export function normalizeRequest(raw: Record<string, unknown>): ContactRequestRow {
  const status = raw.status;
  return {
    id: String(raw.id),
    tenant: String(raw.tenant ?? ''),
    contact: String(raw.contact ?? ''),
    requester: String(raw.requester ?? ''),
    owners: ids(raw.owners),
    purpose: typeof raw.purpose === 'string' ? raw.purpose : '',
    startup: str(raw.startup),
    startup_role: str(raw.startup_role),
    status: isContactRequestStatus(status) ? status : 'pending',
    decision_note: str(raw.decision_note),
    decided_by: str(raw.decided_by),
    decided_at: str(raw.decided_at),
    created: str(raw.created) ?? undefined,
    updated: str(raw.updated) ?? undefined,
    expand: (raw.expand as ContactRequestRow['expand']) ?? undefined
  };
}

function tenantFilter(pb: PocketBase, tenantId: string, extra?: string, params: Record<string, unknown> = {}) {
  return pb.filter(`tenant = {:tenant}${extra ? ` && (${extra})` : ''}`, { tenant: tenantId, ...params });
}

/** Alla kontakter i tenanten (paginerat, fail-soft). Sorteras på efternamn/förnamn. */
export async function listContacts(pb: PocketBase, tenantId: string): Promise<ContactRow[]> {
  const read = (sort: string) =>
    pb.collection(CONTACTS).getFullList<Record<string, unknown>>({
      filter: tenantFilter(pb, tenantId),
      sort,
      batch: 200
    });
  try {
    return (await read('last_name,first_name')).map(normalizeContact);
  } catch {
    try {
      return (await read('')).map(normalizeContact);
    } catch {
      return [];
    }
  }
}

export async function getContact(pb: PocketBase, tenantId: string, id: string): Promise<ContactRow | null> {
  try {
    const row = await pb.collection(CONTACTS).getOne<Record<string, unknown>>(id);
    const c = normalizeContact(row);
    return c.tenant === tenantId ? c : null;
  } catch {
    return null;
  }
}

export interface RequestQuery {
  contactId?: string;
  requesterId?: string;
  /** Förfrågningar där användaren är en av ägarna (LIKE på relationslistan, § 21.3). */
  ownerId?: string;
  startupId?: string;
  status?: ContactRequestStatus | ContactRequestStatus[];
  limit?: number;
}

export async function listContactRequests(
  pb: PocketBase,
  tenantId: string,
  q: RequestQuery = {}
): Promise<ContactRequestRow[]> {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (q.contactId) {
    parts.push('contact = {:contact}');
    params.contact = q.contactId;
  }
  if (q.requesterId) {
    parts.push('requester = {:requester}');
    params.requester = q.requesterId;
  }
  if (q.startupId) {
    parts.push('startup = {:startup}');
    params.startup = q.startupId;
  }
  if (q.ownerId) {
    // `~` på en multi-relation matchar JSON-listan (undviker `?=`-buggen, § 21.3).
    parts.push(`owners ~ "${escFilter(q.ownerId)}"`);
  }
  if (q.status) {
    const statuses = Array.isArray(q.status) ? q.status : [q.status];
    parts.push(`(${statuses.map((s) => `status = "${escFilter(s)}"`).join(' || ')})`);
  }
  const extra = parts.length > 0 ? parts.join(' && ') : undefined;
  const read = (sort: string) =>
    pb.collection(CONTACT_REQUESTS).getList<Record<string, unknown>>(1, Math.min(q.limit ?? 200, 500), {
      filter: tenantFilter(pb, tenantId, extra, params),
      sort,
      expand: 'contact,startup,requester,decided_by'
    });
  try {
    return (await read('-created')).items.map(normalizeRequest);
  } catch {
    try {
      return (await read('')).items.map(normalizeRequest);
    } catch {
      return [];
    }
  }
}

export async function getContactRequest(
  pb: PocketBase,
  tenantId: string,
  id: string
): Promise<ContactRequestRow | null> {
  try {
    const row = await pb
      .collection(CONTACT_REQUESTS)
      .getOne<Record<string, unknown>>(id, { expand: 'contact,startup,requester,decided_by' });
    const r = normalizeRequest(row);
    return r.tenant === tenantId ? r : null;
  } catch {
    return null;
  }
}

/** Antal väntande förfrågningar som väntar på den inloggade (som ägare). */
export async function countPendingRequestsForOwner(
  pb: PocketBase,
  tenantId: string,
  userId: string
): Promise<number> {
  try {
    const res = await pb.collection(CONTACT_REQUESTS).getList(1, 1, {
      filter: tenantFilter(pb, tenantId, `status = "pending" && owners ~ "${escFilter(userId)}"`),
      fields: 'id'
    });
    return res.totalItems;
  } catch {
    return 0;
  }
}

/** Bolag en kontakt är kopplad till (startup_contacts, § 15.2). */
export async function listStartupLinksForContact(pb: PocketBase, contactId: string): Promise<StartupLinkRow[]> {
  try {
    const res = await pb.collection(STARTUP_CONTACTS).getList<StartupLinkRow>(1, 100, {
      filter: pb.filter('contact = {:contact}', { contact: contactId }),
      expand: 'startup'
    });
    return res.items;
  } catch {
    return [];
  }
}

/** Kontakter kopplade till ett bolag (staff-vy på bolagskortet). */
export async function listContactsForStartup(pb: PocketBase, startupId: string): Promise<StartupLinkRow[]> {
  try {
    const res = await pb.collection(STARTUP_CONTACTS).getList<StartupLinkRow>(1, 100, {
      filter: pb.filter('startup = {:startup}', { startup: startupId }),
      expand: 'contact'
    });
    return res.items.filter((l) => l.expand?.contact);
  } catch {
    return [];
  }
}

export interface SharedContactView {
  requestId: string;
  contactId: string;
  name: string;
  organization: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  purpose: string;
  sharedAt: string | null;
}

/**
 * Kontakter som DELATS med ett bolag via en godkänd förfrågan (§ 41.4).
 * Körs som superuser eftersom `contacts` är staff/observer-only — anroparen
 * MÅSTE ha verifierat att den inloggade är länkad till `startupId` (eller är
 * staff) innan detta anropas. Returnerar bara de fält bolaget behöver för
 * att ta kontakt (namn, organisation, roll, e-post, telefon) + syftet.
 */
export async function listSharedContactsForStartup(
  tenantId: string,
  startupId: string
): Promise<SharedContactView[]> {
  const su = await getSuperuserPb();
  if (!su.ok) return [];
  try {
    const res = await su.pb.collection(CONTACT_REQUESTS).getList<Record<string, unknown>>(1, 100, {
      filter: su.pb.filter('tenant = {:tenant} && startup = {:startup} && status = "approved"', {
        tenant: tenantId,
        startup: startupId
      }),
      sort: '-decided_at',
      expand: 'contact'
    });
    const seen = new Set<string>();
    const out: SharedContactView[] = [];
    for (const raw of res.items) {
      const r = normalizeRequest(raw);
      const c = r.expand?.contact;
      if (!c || seen.has(r.contact)) continue;
      seen.add(r.contact);
      out.push({
        requestId: r.id,
        contactId: r.contact,
        name: contactDisplayName({ first_name: c.first_name ?? '', last_name: c.last_name ?? '' }),
        organization: str(c.organization),
        role: r.startup_role ?? str(c.primary_role),
        email: str(c.email),
        phone: str(c.phone),
        purpose: r.purpose,
        sharedAt: r.decided_at
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Movexum-personal i tenanten (admin/incubator_lead/coach/mentor) — kandidater
 * som kontaktägare. E-post behövs för att lösa "Ägare"-kolumnen vid import;
 * PB döljer andra användares e-post för vanliga tokens (`emailVisibility`), så
 * vi faller tillbaka på superuser när adresser saknas. Fail-soft → [].
 */
export async function listStaffUsers(pb: PocketBase, tenantId: string): Promise<StaffUser[]> {
  interface UserRow {
    id: string;
    display_name?: string;
    email?: string;
    roles?: unknown;
  }
  const read = async (client: PocketBase) => {
    const res = await client.collection('users').getList<UserRow>(1, 200, {
      filter: client.filter('tenant = {:tenant}', { tenant: tenantId }),
      sort: 'display_name',
      fields: 'id,display_name,email,roles'
    });
    return res.items
      .filter((u) => Array.isArray(u.roles) && (u.roles as Role[]).some((r) => CONTACT_BOOK_ROLES.includes(r)))
      .map((u) => ({
        id: String(u.id),
        name: u.display_name || (u.email ? u.email.split('@')[0] : 'Kollega'),
        email: u.email ? u.email.toLowerCase() : null,
        roles: (u.roles as Role[]).filter(Boolean)
      }));
  };
  try {
    const users = await read(pb);
    if (users.length > 0 && users.every((u) => u.email)) return users;
    const su = await getSuperuserPb();
    if (!su.ok) return users;
    try {
      return await read(su.pb);
    } catch {
      return users;
    }
  } catch {
    return [];
  }
}

export function staffNameMap(users: readonly StaffUser[]): Map<string, string> {
  return new Map(users.map((u) => [u.id, u.name]));
}
