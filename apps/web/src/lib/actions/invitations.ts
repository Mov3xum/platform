'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { inviteToEvent, sendEventInvitations } from '@/lib/core/write/event-invitations';
import {
  CONTACT_LIST_LIMIT,
  contactDisplayName,
  contactSearchFilter,
  countContactsByCategory,
  loadStartupReach,
  startupRecipientsSummary,
  type ContactRow
} from '@/lib/events/invite-candidates';
import { requestOrigin } from '@/lib/request-origin';
import type { ContactCategory, Role } from '@platform/shared';

// Inbjudningar till event (CLAUDE.md § 53.5). Tunna server actions:
// inloggad användare → skrivlagret, som äger roll-, tenant- och
// avregistreringskontrollerna. Listningarna (kontaktboken, bolag) returnerar
// aldrig e-postadresser — bara om mottagaren går att nå. Alla utskick är
// mänskliga klick.

export type InvitationState = { ok?: boolean; error?: string; notice?: string };

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function revalidateEvent(eventId: string) {
  revalidatePath('/inflode/inbjudningar');
  revalidatePath(`/inflode/inbjudningar/${eventId}`);
  revalidatePath(`/events/${eventId}`);
}

async function requireManager() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES]) || !user.tenant) return null;
  return user;
}

/** Vilka kontakter/användare som redan finns på eventets lista. */
async function onList(pb: Awaited<ReturnType<typeof getServerPb>>, tenant: string, eventId: string) {
  if (!ID.test(eventId)) return { contacts: new Set<string>(), startups: new Set<string>() };
  const rows = await pb.collection('event_signups').getFullList<{ contact?: string; startup?: string }>({
    filter: pb.filter('tenant = {:t} && event = {:e}', { t: tenant, e: eventId }),
    fields: 'id,contact,startup'
  });
  return {
    contacts: new Set(rows.map((r) => r.contact).filter((v): v is string => Boolean(v))),
    startups: new Set(rows.map((r) => r.startup).filter((v): v is string => Boolean(v)))
  };
}

export interface InviteContactOption {
  id: string;
  name: string;
  organization: string;
  category: string;
  hasEmail: boolean;
  optedOut: boolean;
  alreadyInvited: boolean;
}

export interface InviteContactsResult {
  error?: string;
  items: InviteContactOption[];
  total: number;
  counts?: { all: number; byCategory: Partial<Record<ContactCategory, number>> };
}

export async function listInviteContactsAction(input: {
  eventId: string;
  category?: string;
  q?: string;
  withCounts?: boolean;
}): Promise<InviteContactsResult> {
  const user = await requireManager();
  if (!user) return { error: 'Åtkomst nekad.', items: [], total: 0 };
  const pb = await getServerPb();
  try {
    const [res, list, counts] = await Promise.all([
      pb.collection('contacts').getList<ContactRow>(1, CONTACT_LIST_LIMIT, {
        filter: contactSearchFilter(pb, user.tenant, { category: input.category, q: String(input.q ?? '').slice(0, 120) }),
        fields: 'id,first_name,last_name,email,organization,category,invite_opt_out',
        sort: 'last_name,first_name'
      }),
      onList(pb, user.tenant, input.eventId),
      input.withCounts ? countContactsByCategory(pb, user.tenant) : Promise.resolve(undefined)
    ]);
    return {
      items: res.items.map((c) => ({
        id: c.id,
        name: contactDisplayName(c),
        organization: c.organization || '',
        category: c.category || '',
        hasEmail: Boolean(c.email),
        optedOut: c.invite_opt_out === true,
        alreadyInvited: list.contacts.has(c.id)
      })),
      total: res.totalItems,
      counts
    };
  } catch (err) {
    console.error('[invitations] contact list failed', (err as { status?: number })?.status);
    return { error: 'Kunde inte läsa kontaktboken.', items: [], total: 0 };
  }
}

export interface InviteStartupOption {
  id: string;
  name: string;
  status: string;
  via: 'members' | 'contacts' | 'company' | 'none';
  count: number;
  alreadyInvited: boolean;
}

export async function listInviteStartupsAction(input: {
  eventId: string;
}): Promise<{ error?: string; items: InviteStartupOption[] }> {
  const user = await requireManager();
  if (!user) return { error: 'Åtkomst nekad.', items: [] };
  const pb = await getServerPb();
  try {
    const [reach, list] = await Promise.all([loadStartupReach(pb, user.tenant, null), onList(pb, user.tenant, input.eventId)]);
    return {
      items: reach.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        ...startupRecipientsSummary(r),
        alreadyInvited: list.startups.has(r.id)
      }))
    };
  } catch (err) {
    console.error('[invitations] startup list failed', (err as { status?: number })?.status);
    const msg = err instanceof Error && err.message.includes('superuser') ? err.message : 'Kunde inte läsa bolagen.';
    return { error: msg, items: [] };
  }
}

export async function inviteToEventAction(input: {
  eventId: string;
  contactIds: string[];
  startupIds: string[];
}): Promise<InvitationState> {
  const user = await requireUser();
  const res = await inviteToEvent(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    {
      eventId: String(input.eventId || ''),
      contactIds: input.contactIds,
      startupIds: input.startupIds,
      baseUrl: await requestOrigin()
    }
  );
  if (!res.ok) return { error: res.error };
  revalidateEvent(input.eventId);
  const { invited, sent, failed, skipped, unreachableStartups } = res.value;
  const notes = [
    skipped.already ? `${skipped.already} fanns redan på listan` : '',
    skipped.optOut ? `${skipped.optOut} har avregistrerat sig` : '',
    skipped.noEmail ? `${skipped.noEmail} saknar e-post` : '',
    skipped.overCap ? `${skipped.overCap} över taket` : '',
    unreachableStartups ? `${unreachableStartups} bolag saknar mottagare` : '',
    failed ? `${failed} mejl misslyckades — försök igen med "Skicka ej utskickade"` : ''
  ].filter(Boolean);
  return {
    ok: true,
    notice: `${invited} inbjudna, ${sent} mejl skickade.${notes.length ? ` ${notes.join(' · ')}.` : ''}`
  };
}

export async function sendInvitationsAction(input: { eventId: string; mode: 'pending' | 'reminder' }): Promise<InvitationState> {
  const user = await requireUser();
  const res = await sendEventInvitations(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    { eventId: input.eventId, mode: input.mode === 'reminder' ? 'reminder' : 'pending', baseUrl: await requestOrigin() }
  );
  if (!res.ok) return { error: res.error };
  revalidateEvent(input.eventId);
  const { sent, failed, optedOut } = res.value;
  return {
    ok: true,
    notice: `${sent} mejl skickade${failed ? `, ${failed} misslyckades` : ''}${optedOut ? ` (${optedOut} avregistrerade hoppades över)` : ''}.`
  };
}
