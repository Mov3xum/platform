'use client';

import { actionErrorMessage } from '@/lib/action-error';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactDisplayName,
  contactSubtitle,
  type ContactCategory
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { changeContactGroupMembersAction } from '@/lib/actions/contact-groups';
import { CategoryChip, Initials, Notice, OwnerChip, btnGhost, btnPrimary, inputClass } from './ui';

/** Serialiserad kontaktrad för klientlistan — INGA kontaktuppgifter (e-post/telefon) skickas till listan. */
export interface BrowserContact {
  id: string;
  first_name: string;
  last_name: string;
  organization: string | null;
  primary_role: string | null;
  category: ContactCategory | null;
  kommun: string | null;
  skills: string | null;
  owners: string[];
  /** Egna grupper (§ 45.8) — id:n. */
  groups: string[];
  linkedStartups: number;
  pendingRequests: number;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface BrowserOwner {
  id: string;
  name: string;
}

export interface BrowserGroup {
  id: string;
  name: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function ContactsBrowser({
  contacts,
  owners,
  meId,
  groups: groupList = [],
  initialGroup = '',
  canEdit = false
}: {
  contacts: BrowserContact[];
  owners: BrowserOwner[];
  meId: string;
  groups?: BrowserGroup[];
  initialGroup?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ContactCategory | ''>('');
  const [owner, setOwner] = useState<string>('');
  const [group, setGroup] = useState<string>(groupList.some((g) => g.id === initialGroup) ? initialGroup : '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('');
  const [message, setMessage] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const ownerName = useMemo(() => new Map(owners.map((o) => [o.id, o.name])), [owners]);
  const groupName = useMemo(() => new Map(groupList.map((g) => [g.id, g.name])), [groupList]);

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return contacts.filter((c) => {
      if (category && c.category !== category) return false;
      if (group === 'none' && c.groups.length > 0) return false;
      if (group && group !== 'none' && !c.groups.includes(group)) return false;
      if (owner === 'me' && !c.owners.includes(meId)) return false;
      if (owner && owner !== 'me' && !c.owners.includes(owner)) return false;
      if (!needle) return true;
      const hay = norm(
        [
          c.first_name,
          c.last_name,
          c.organization ?? '',
          c.primary_role ?? '',
          c.kommun ?? '',
          c.skills ?? '',
          ...c.owners.map((id) => ownerName.get(id) ?? ''),
          ...c.groups.map((id) => groupName.get(id) ?? '')
        ].join(' ')
      );
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [contacts, q, category, owner, group, meId, ownerName, groupName]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) for (const c of filtered) next.delete(c.id);
      else for (const c of filtered) next.add(c.id);
      return next;
    });
  const runBulk = (mode: 'add' | 'remove') => {
    if (!target || selected.size === 0) return;
    setMessage(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof changeContactGroupMembersAction>>;
      try {
        res = await changeContactGroupMembersAction({ groupId: target, contactIds: [...selected], mode });
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Grupperna kunde inte sparas. Ladda om sidan och försök igen.') };
      }
      if (res.error) setMessage({ kind: 'error', text: res.notice ? `${res.error} ${res.notice}` : res.error });
      else {
        setMessage({ kind: 'notice', text: res.notice ?? 'Klart.' });
        setSelected(new Set());
      }
      router.refresh();
    });
  };

  // Gruppera på första bokstaven i efternamnet (eller förnamnet).
  const groups = useMemo(() => {
    const map = new Map<string, BrowserContact[]>();
    for (const c of filtered) {
      const key = ((c.last_name || c.first_name).trim()[0] ?? '#').toUpperCase();
      const letter = /[A-ZÅÄÖ]/.test(key) ? key : '#';
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'sv'));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-subtle">
            <Icon name="search" size={14} />
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök namn, organisation, roll, kommun, kompetens…"
            className={`${inputClass} pl-9`}
            aria-label="Sök kontakter"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ContactCategory | '')}
          className={`${inputClass} w-auto`}
          aria-label="Kategori"
        >
          <option value="">Alla kategorier</option>
          {CONTACT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CONTACT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {groupList.length > 0 && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${inputClass} w-auto`} aria-label="Grupp">
            <option value="">Alla grupper</option>
            {groupList.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="none">Utan grupp</option>
          </select>
        )}
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`${inputClass} w-auto`} aria-label="Ägare">
          <option value="">Alla ägare</option>
          <option value="me">Mina kontakter</option>
          {owners
            .filter((o) => o.id !== meId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
        <span className="text-xs text-foreground-subtle mx-tnum">
          {filtered.length} av {contacts.length}
        </span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-default bg-canvas-subtle px-3 py-2">
          <label className="inline-flex items-center gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAllFiltered}
              disabled={filtered.length === 0}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
            Välj alla i listan
          </label>
          <span className="text-xs text-foreground-subtle mx-tnum">{selected.size} valda</span>
          <span className="flex-1" />
          {groupList.length === 0 ? (
            <Link href="/kontakter/grupper" className="text-sm text-link hover:underline">
              Skapa en grupp för att samla kontakter
            </Link>
          ) : (
            <>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={`${inputClass} w-auto py-1.5`}
                aria-label="Grupp för valda kontakter"
              >
                <option value="">Välj grupp…</option>
                {groupList.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !target || selected.size === 0}
                onClick={() => runBulk('add')}
              >
                Lägg till i grupp
              </button>
              <button
                type="button"
                className={btnGhost}
                disabled={pending || !target || selected.size === 0}
                onClick={() => runBulk('remove')}
              >
                Ta bort ur grupp
              </button>
            </>
          )}
          {selected.size > 0 && (
            <button type="button" className="text-xs text-link hover:underline" onClick={() => setSelected(new Set())}>
              Rensa val
            </button>
          )}
        </div>
      )}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
          Inga kontakter matchar.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([letter, items]) => (
            <section key={letter}>
              <h2 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wider text-foreground-subtle">{letter}</h2>
              <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
                {items.map((c) => {
                  const name = contactDisplayName(c);
                  const sub = contactSubtitle(c);
                  return (
                    <li key={c.id} className="flex items-center">
                      {canEdit && (
                        <label className="flex cursor-pointer items-center self-stretch pl-4" aria-label={`Välj ${name}`}>
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                            className="h-4 w-4 accent-[var(--color-brand)]"
                          />
                        </label>
                      )}
                      <Link
                        href={`/kontakter/${c.id}`}
                        className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-canvas-subtle"
                      >
                        <Initials name={name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{name}</span>
                            <CategoryChip category={c.category} />
                            {c.groups.slice(0, 2).map((id) =>
                              groupName.has(id) ? (
                                <span
                                  key={id}
                                  className="inline-flex rounded-full border border-default px-2 py-0.5 text-[11px] font-medium text-foreground-muted"
                                >
                                  {groupName.get(id)}
                                </span>
                              ) : null
                            )}
                            {c.groups.length > 2 && (
                              <span className="text-[11px] text-foreground-subtle">+{c.groups.length - 2}</span>
                            )}
                            {c.pendingRequests > 0 && (
                              <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-[11px] font-semibold text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul">
                                {c.pendingRequests} väntar
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-foreground-muted">
                            {sub || <span className="text-foreground-subtle">Ingen organisation angiven</span>}
                            {c.kommun ? ` · ${c.kommun}` : ''}
                          </div>
                        </div>
                        <div className="hidden items-center gap-1 text-foreground-subtle sm:flex">
                          {c.hasEmail && <Icon name="send" size={13} />}
                          {c.hasPhone && <Icon name="mic" size={13} />}
                          {c.linkedStartups > 0 && (
                            <span className="ml-1 text-[11px] mx-tnum">
                              {c.linkedStartups} bolag
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {c.owners.length === 0 ? (
                            <span className="text-[11px] text-foreground-subtle">Ingen ägare</span>
                          ) : (
                            c.owners.slice(0, 3).map((id) => (
                              <OwnerChip key={id} name={ownerName.get(id) ?? 'Kollega'} isMe={id === meId} />
                            ))
                          )}
                          {c.owners.length > 3 && (
                            <span className="text-[11px] text-foreground-subtle">+{c.owners.length - 3}</span>
                          )}
                        </div>
                        <Icon name="chevron" size={14} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
