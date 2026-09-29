'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactDisplayName,
  contactSubtitle,
  type ContactCategory
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { CategoryChip, Initials, OwnerChip, inputClass } from './ui';

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
  linkedStartups: number;
  pendingRequests: number;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface BrowserOwner {
  id: string;
  name: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function ContactsBrowser({
  contacts,
  owners,
  meId
}: {
  contacts: BrowserContact[];
  owners: BrowserOwner[];
  meId: string;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ContactCategory | ''>('');
  const [owner, setOwner] = useState<string>('');
  const ownerName = useMemo(() => new Map(owners.map((o) => [o.id, o.name])), [owners]);

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return contacts.filter((c) => {
      if (category && c.category !== category) return false;
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
          ...c.owners.map((id) => ownerName.get(id) ?? '')
        ].join(' ')
      );
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [contacts, q, category, owner, meId, ownerName]);

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
                    <li key={c.id}>
                      <Link
                        href={`/kontakter/${c.id}`}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-canvas-subtle"
                      >
                        <Initials name={name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{name}</span>
                            <CategoryChip category={c.category} />
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
