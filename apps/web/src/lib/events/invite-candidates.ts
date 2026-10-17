import 'server-only';
import type PocketBase from 'pocketbase';
import {
  CONTACT_CATEGORIES,
  contactSearchWords,
  isContactCategory,
  type ContactCategory
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Vem som kan bjudas in till ett event (CLAUDE.md § 53.5): kontakter i
 * kontaktboken (§ 45) och bolag i portföljen. Delas av listningen i
 * inbjudningspanelen och av skrivlagret, så att det personalen ser är exakt
 * det som skickas.
 *
 * Ett bolag nås via (i tur och ordning): bolagsmedlemmarnas konton
 * (`startup_member` länkad till bolaget), annars bolagets huvudkontakter i
 * kontaktboken (`startup_contacts.is_primary`), annars bolagets egen
 * e-postadress. Medlemmarnas e-post är dold för vanliga tokens
 * (`emailVisibility`), så den läses med den cachade superusern — anroparen
 * MÅSTE ha verifierat att den inloggade är staff i tenanten. Adresserna
 * lämnar aldrig servern i listningen (bara antal).
 */

const CHUNK = 40;
export const CONTACT_LIST_LIMIT = 1000;
export const STARTUP_LIST_LIMIT = 1000;

function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

export type ContactRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  organization?: string;
  category?: string;
  invite_opt_out?: boolean;
};

export function contactDisplayName(c: Pick<ContactRow, 'first_name' | 'last_name' | 'email'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Kontakt';
}

/** Kontakter med givna id:n i tenanten (användarens token, RLS). */
export async function loadContactsByIds(pb: PocketBase, tenant: string, ids: readonly string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    out.push(
      ...(await pb.collection('contacts').getFullList<ContactRow>({
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'id', part)}`,
        fields: 'id,first_name,last_name,email,organization,category,invite_opt_out'
      }))
    );
  }
  return out;
}

/** Filter för kontaktsökningen: kategori + varje sökord i något fält. */
export function contactSearchFilter(pb: PocketBase, tenant: string, opts: { category?: string; q?: string }): string {
  const parts = [pb.filter('tenant = {:t}', { t: tenant })];
  if (isContactCategory(opts.category)) parts.push(pb.filter('category = {:c}', { c: opts.category }));
  contactSearchWords(opts.q).forEach((w) => {
    parts.push(
      pb.filter('(first_name ~ {:w} || last_name ~ {:w} || organization ~ {:w} || email ~ {:w})', { w })
    );
  });
  return parts.join(' && ');
}

export async function countContactsByCategory(
  pb: PocketBase,
  tenant: string
): Promise<{ all: number; byCategory: Partial<Record<ContactCategory, number>> }> {
  const base = pb.filter('tenant = {:t}', { t: tenant });
  const [all, ...counts] = await Promise.all([
    pb.collection('contacts').getList(1, 1, { filter: base, fields: 'id' }).then((r) => r.totalItems),
    ...CONTACT_CATEGORIES.map((c) =>
      pb
        .collection('contacts')
        .getList(1, 1, { filter: `${base} && ${pb.filter('category = {:c}', { c })}`, fields: 'id' })
        .then((r) => r.totalItems)
    )
  ]);
  const byCategory: Partial<Record<ContactCategory, number>> = {};
  CONTACT_CATEGORIES.forEach((c, i) => {
    if (counts[i]) byCategory[c] = counts[i];
  });
  return { all, byCategory };
}

export interface StartupMember {
  id: string;
  name: string;
  email: string;
}

export interface StartupReach {
  id: string;
  name: string;
  status: string;
  members: StartupMember[];
  primaryContacts: ContactRow[];
  /** Bolagets egen adress (bara när varken medlemmar eller huvudkontakter finns). */
  companyEmail: string;
}

/** Vem ett bolag faktiskt når — se modulkommentaren. */
export function startupRecipientsSummary(r: StartupReach): {
  via: 'members' | 'contacts' | 'company' | 'none';
  count: number;
} {
  const members = r.members.filter((m) => m.email);
  if (members.length > 0) return { via: 'members', count: members.length };
  const contacts = r.primaryContacts.filter((c) => c.email && c.invite_opt_out !== true);
  if (contacts.length > 0) return { via: 'contacts', count: contacts.length };
  if (r.companyEmail) return { via: 'company', count: 1 };
  return { via: 'none', count: 0 };
}

type StartupRow = { id: string; name?: string; status?: string; email?: string };
type UserRow = { id: string; display_name?: string; email?: string; roles?: string[]; linked_startups?: string[] };

/**
 * Hur varje bolag nås. `startupIds` = null ⇒ tenantens alla bolag (listningen).
 * Kastar om superusern saknas — utan den kan medlemmarnas e-post inte läsas.
 */
export async function loadStartupReach(
  pb: PocketBase,
  tenant: string,
  startupIds: readonly string[] | null
): Promise<StartupReach[]> {
  const base = pb.filter('tenant = {:t}', { t: tenant });
  let startups: StartupRow[] = [];
  if (startupIds === null) {
    const res = await pb.collection('startups').getList<StartupRow>(1, STARTUP_LIST_LIMIT, {
      filter: base,
      fields: 'id,name,status,email',
      sort: 'name'
    });
    startups = res.items;
  } else {
    for (let i = 0; i < startupIds.length; i += CHUNK) {
      const part = startupIds.slice(i, i + CHUNK);
      startups.push(
        ...(await pb.collection('startups').getFullList<StartupRow>({
          filter: `${base} && ${anyOf(pb, 'id', part)}`,
          fields: 'id,name,status,email'
        }))
      );
    }
  }
  if (startups.length === 0) return [];
  const wanted = new Set(startups.map((s) => s.id));

  const su = await getSuperuserPb();
  if (!su.ok) throw new Error('Bolagsmedlemmarnas e-post kan inte läsas (superuser saknas).');
  const users = await su.pb.collection('users').getFullList<UserRow>({
    filter: su.pb.filter('tenant = {:t} && roles ~ "startup_member"', { t: tenant }),
    fields: 'id,display_name,email,roles,linked_startups'
  });
  const membersBy = new Map<string, StartupMember[]>();
  for (const u of users) {
    if (!(u.roles ?? []).includes('startup_member') || !u.email) continue;
    for (const sid of u.linked_startups ?? []) {
      if (!wanted.has(sid)) continue;
      const list = membersBy.get(sid) ?? [];
      list.push({ id: u.id, name: u.display_name || 'Bolagsmedlem', email: u.email });
      membersBy.set(sid, list);
    }
  }

  // Huvudkontakter bara för bolag utan medlemmar.
  const needContacts = startups.filter((s) => !membersBy.has(s.id)).map((s) => s.id);
  const contactIdsBy = new Map<string, string[]>();
  for (let i = 0; i < needContacts.length; i += CHUNK) {
    const part = needContacts.slice(i, i + CHUNK);
    const links = await pb.collection('startup_contacts').getFullList<{ startup: string; contact: string }>({
      filter: `is_primary = true && ${anyOf(pb, 'startup', part)}`,
      fields: 'startup,contact'
    });
    for (const l of links) contactIdsBy.set(l.startup, [...(contactIdsBy.get(l.startup) ?? []), l.contact]);
  }
  const allContactIds = [...new Set([...contactIdsBy.values()].flat())];
  const contacts = allContactIds.length > 0 ? await loadContactsByIds(pb, tenant, allContactIds) : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  return startups.map((s) => {
    const members = membersBy.get(s.id) ?? [];
    const primaryContacts = (contactIdsBy.get(s.id) ?? [])
      .map((id) => contactById.get(id))
      .filter((c): c is ContactRow => Boolean(c));
    return {
      id: s.id,
      name: s.name || 'Bolag',
      status: s.status || '',
      members,
      primaryContacts,
      companyEmail: members.length === 0 && primaryContacts.length === 0 ? (s.email || '').trim() : ''
    };
  });
}
