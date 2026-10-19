'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { removeEventInvitation } from '@/lib/core/write/event-invitations';
import {
  CONTACT_LIST_LIMIT,
  contactDisplayName,
  contactSearchFilter,
  countContactsByCategory,
  countContactsByGroup,
  loadInviteUsers,
  loadStartupReach,
  type InviteUserKind,
  startupRecipientsSummary,
  type ContactRow
} from '@/lib/events/invite-candidates';
import { listContactGroups } from '@/lib/contacts/data';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactSearchWords,
  inviteSelectionKey,
  isContactCategory,
  matchesContactSearch,
  parseInviteList,
  type ContactCategory,
  type InviteSelectionKind,
  type Role
} from '@platform/shared';

// Inbjudningar till event (CLAUDE.md § 53.5 / § 54). Själva utskicket är
// sedan konsolideringen 2026-10 en KAMPANJ (mall "Eventinbjudan" med eventets
// deltagarlista som mottagargrupp) — här finns listningen för
// mottagarpanelen (kontaktboken, egna grupper, personal, bolagsmedlemmar,
// bolag; aldrig e-postadresser, bara om mottagaren går att nå) och
// borttagning av en inbjudan.

export type InvitationState = { ok?: boolean; error?: string; notice?: string };

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function revalidateEvent(eventId: string) {
  revalidatePath('/inflode/inbjudningar');
  revalidatePath(`/inflode/inbjudningar/${eventId}`);
  revalidatePath(`/inflode/events/${eventId}`);
}

async function requireManager() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES]) || !user.tenant) return null;
  return user;
}

/** Vilka kontakter/användare/bolag som redan finns på eventets lista. */
async function onList(pb: Awaited<ReturnType<typeof getServerPb>>, tenant: string, eventId: string) {
  const empty = { contacts: new Set<string>(), users: new Set<string>(), startups: new Set<string>() };
  if (!ID.test(eventId)) return empty;
  const rows = await pb.collection('event_signups').getFullList<{ contact?: string; user?: string; startup?: string }>({
    filter: pb.filter('tenant = {:t} && event = {:e}', { t: tenant, e: eventId }),
    fields: 'id,contact,user,startup'
  });
  const set = (k: 'contact' | 'user' | 'startup') => new Set(rows.map((r) => r[k]).filter((v): v is string => Boolean(v)));
  return { contacts: set('contact'), users: set('user'), startups: set('startup') };
}

/** En rad i inbjudningspanelen — aldrig någon e-postadress. */
export interface InviteOption {
  /** `c:`/`u:`/`s:` + id (`inviteSelectionKey`). */
  key: string;
  kind: InviteSelectionKind;
  name: string;
  detail: string;
  /** Varför raden inte kan väljas, eller hur ett bolag nås. */
  note: string;
  selectable: boolean;
}

export interface InviteListMeta {
  contacts: number;
  byCategory: Partial<Record<ContactCategory, number>>;
  groups: Array<{ id: string; name: string; count: number }>;
  staff: number;
  members: number;
  startups: number;
  /** Fel i någon delräkning — listan fungerar ändå. */
  warning?: string;
}

export interface InviteOptionsResult {
  error?: string;
  /** Delvis resultat — listan visas ändå. */
  warning?: string;
  items: InviteOption[];
  /** Totalt antal träffar (kan vara fler än `items`). */
  total: number;
  meta?: InviteListMeta;
}

const STARTUP_VIA: Record<'members' | 'contacts' | 'company' | 'none', (n: number) => string> = {
  members: (n) => `${n} ${n === 1 ? 'medlem' : 'medlemmar'}`,
  contacts: (n) => `${n} ${n === 1 ? 'huvudkontakt' : 'huvudkontakter'}`,
  company: () => 'bolagets e-post',
  none: () => 'ingen mottagare'
};

const STARTUP_STATUS: Record<string, string> = { active: 'Aktivt', alumni: 'Alumn', paused: 'Pausat', rejected: 'Avslutat' };

async function loadMeta(pb: Awaited<ReturnType<typeof getServerPb>>, tenant: string): Promise<InviteListMeta> {
  const warnings: string[] = [];
  const [cats, groupRes, users, startups] = await Promise.all([
    countContactsByCategory(pb, tenant).catch(() => {
      warnings.push('kontaktboken');
      return { all: 0, byCategory: {} };
    }),
    listContactGroups(pb, tenant),
    loadInviteUsers(pb, tenant).catch(() => {
      warnings.push('användarna');
      return [];
    }),
    pb
      .collection('startups')
      .getList(1, 1, { filter: pb.filter('tenant = {:t}', { t: tenant }), fields: 'id' })
      .then((r) => r.totalItems)
      .catch(() => 0)
  ]);
  const groupCounts = groupRes.groups.length ? await countContactsByGroup(pb, tenant, groupRes.groups.map((g) => g.id)) : {};
  if (groupRes.error) warnings.push('grupperna');
  return {
    contacts: cats.all,
    byCategory: cats.byCategory,
    groups: groupRes.groups.map((g) => ({ id: g.id, name: g.name, count: groupCounts[g.id] ?? 0 })),
    staff: users.filter((u) => u.kind === 'staff').length,
    members: users.filter((u) => u.kind === 'members').length,
    startups,
    ...(warnings.length ? { warning: `Kunde inte räkna ${warnings.join(', ')}.` } : {})
  };
}

/**
 * Listan i inbjudningspanelens dropdown: kontaktboken (alla/kategori/egen
 * grupp), Movexum-personalen, bolagsmedlemmarna eller bolagen — med sökning.
 * Användarnas e-post läses via superusern EFTER rollkontrollen och lämnar
 * aldrig servern.
 */
export async function listInviteOptionsAction(input: {
  eventId: string;
  list?: string;
  q?: string;
  withMeta?: boolean;
}): Promise<InviteOptionsResult> {
  const user = await requireManager();
  if (!user) return { error: 'Åtkomst nekad.', items: [], total: 0 };
  const pb = await getServerPb();
  const ref = parseInviteList(input.list, CONTACT_CATEGORIES);
  const q = String(input.q ?? '').slice(0, 120);
  const words = contactSearchWords(q);
  try {
    const [list, meta] = await Promise.all([
      onList(pb, user.tenant, input.eventId),
      input.withMeta ? loadMeta(pb, user.tenant) : Promise.resolve(undefined)
    ]);

    const userOptions = async (kind?: InviteUserKind): Promise<InviteOption[]> =>
      (await loadInviteUsers(pb, user.tenant, kind ? { kind } : {}))
        .filter((u) => matchesContactSearch([u.name, u.email, u.startupName], words))
        .map((u) => {
          const already = list.users.has(u.id);
          return {
            key: inviteSelectionKey('user', u.id),
            kind: 'user',
            name: u.name,
            detail: u.kind === 'staff' ? 'Movexum-personal' : u.startupName ? `Bolagsmedlem · ${u.startupName}` : 'Bolagsmedlem',
            note: already ? 'på listan' : !u.email ? 'saknar e-post' : '',
            selectable: !already && Boolean(u.email)
          };
        });

    const contactOptions = async (): Promise<{ items: InviteOption[]; total: number }> => {
      const res = await pb.collection('contacts').getList<ContactRow>(1, CONTACT_LIST_LIMIT, {
        filter: contactSearchFilter(pb, user.tenant, {
          category: ref.kind === 'category' ? ref.category : undefined,
          group: ref.kind === 'group' ? ref.id : undefined,
          q
        }),
        fields: 'id,first_name,last_name,email,organization,category,invite_opt_out',
        sort: 'last_name,first_name'
      });
      return {
        total: res.totalItems,
        items: res.items.map((c) => {
          const already = list.contacts.has(c.id);
          const optedOut = c.invite_opt_out === true;
          return {
            key: inviteSelectionKey('contact', c.id),
            kind: 'contact',
            name: contactDisplayName(c),
            detail: [c.organization || '', isContactCategory(c.category) ? CONTACT_CATEGORY_LABELS[c.category] : '']
              .filter(Boolean)
              .join(' · '),
            note: already ? 'på listan' : optedOut ? 'avregistrerad' : !c.email ? 'saknar e-post' : '',
            selectable: !already && !optedOut && Boolean(c.email)
          };
        })
      };
    };

    if (ref.kind === 'staff' || ref.kind === 'members') {
      const items = await userOptions(ref.kind);
      return { items: items.slice(0, CONTACT_LIST_LIMIT), total: items.length, meta };
    }

    if (ref.kind === 'startups') {
      const reach = (await loadStartupReach(pb, user.tenant, null)).filter((r) => matchesContactSearch([r.name], words));
      const items: InviteOption[] = reach.map((r) => {
        const sum = startupRecipientsSummary(r);
        const already = list.startups.has(r.id);
        return {
          key: inviteSelectionKey('startup', r.id),
          kind: 'startup',
          name: r.name,
          detail: STARTUP_STATUS[r.status] ?? '',
          note: already ? 'inbjudet' : STARTUP_VIA[sum.via](sum.count),
          selectable: !already && sum.via !== 'none'
        };
      });
      return { items, total: items.length, meta };
    }

    if (ref.kind === 'everyone') {
      // Användarna först (få), sedan kontaktboken. Saknas superusern visas
      // kontakterna ändå med en varning i stället för ett tomt resultat.
      const [users, contacts] = await Promise.all([
        userOptions().catch(() => null),
        contactOptions()
      ]);
      const items = [...(users ?? []), ...contacts.items].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      return {
        items,
        total: (users?.length ?? 0) + contacts.total,
        meta,
        ...(users ? {} : { warning: 'Plattformens användare kunde inte läsas (superuser saknas) — bara kontaktboken visas.' })
      };
    }

    const contacts = await contactOptions();
    return { items: contacts.items, total: contacts.total, meta };
  } catch (err) {
    console.error('[invitations] option list failed', (err as { status?: number })?.status);
    const msg = err instanceof Error && err.message.includes('superuser') ? err.message : 'Kunde inte läsa listan.';
    return { error: msg, items: [], total: 0 };
  }
}

export async function removeInvitationAction(signupId: string): Promise<InvitationState> {
  const user = await requireUser();
  let res: Awaited<ReturnType<typeof removeEventInvitation>>;
  try {
    res = await removeEventInvitation(
      await getServerPb(),
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      String(signupId || '')
    );
  } catch (err) {
    console.error('[invitations] remove failed', err instanceof Error ? err.message : 'unknown');
    return { error: 'Inbjudan kunde inte tas bort. Ladda om sidan och försök igen.' };
  }
  if (!res.ok) return { error: res.error };
  revalidateEvent(res.value.eventId);
  return { ok: true, notice: 'Inbjudan togs bort.' };
}
