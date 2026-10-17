'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { Icon } from '@/components/proto';
import {
  inviteToEventAction,
  listInviteContactsAction,
  listInviteStartupsAction,
  type InvitationState,
  type InviteContactOption,
  type InviteContactsResult,
  type InviteStartupOption
} from '@/lib/actions/invitations';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactSearchWords,
  isContactCategory,
  matchesContactSearch
} from '@platform/shared';

// Inbjudningspanelen (CLAUDE.md § 53.5) — samma på eventsidan och under
// Marknadsverktyg → Inbjudningar. Kryssa i kontakter per kategori ("alla
// investerare") eller hela bolag; urvalet följer med mellan flikar och
// kategorier, och ETT utskick skickar allt. Listorna hämtas dynamiskt och
// innehåller aldrig e-postadresser — bara om mottagaren går att nå.

type Tab = 'contacts' | 'startups';

const STARTUP_VIA: Record<InviteStartupOption['via'], (n: number) => string> = {
  members: (n) => `${n} ${n === 1 ? 'medlem' : 'medlemmar'}`,
  contacts: (n) => `${n} ${n === 1 ? 'huvudkontakt' : 'huvudkontakter'}`,
  company: () => 'bolagets e-post',
  none: () => 'ingen mottagare'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktiva',
  alumni: 'Alumni',
  paused: 'Pausade',
  rejected: 'Avslutade'
};

function Notice({ state }: { state: InvitationState | null }) {
  if (!state || (!state.error && !state.notice)) return null;
  return (
    <div
      role="status"
      className="mx-t-13"
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: state.error ? 'var(--movexum-pastell-orange)' : 'var(--movexum-pastell-gron)',
        color: state.error ? 'var(--movexum-morkorange)' : 'var(--movexum-morkgron)'
      }}
    >
      {state.error ?? state.notice}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="mx-t-12"
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--color-brand)' : 'var(--mx-line-soft)'}`,
        background: active ? 'var(--color-brand)' : 'transparent',
        color: active ? 'var(--color-brand-foreground)' : 'var(--color-foreground-muted)',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}

function Row({
  checked,
  disabled,
  onChange,
  title,
  detail,
  note
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
  note: string;
}) {
  return (
    <label
      className="mx-t-13 mx-flex mx-items-c mx-gap-2"
      style={{ padding: '6px 4px', opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--movexum-morkbla)' }}
      />
      <span style={{ flex: 1, minWidth: 0 }} className="mx-truncate">
        {title}
        {detail ? <span className="mx-muted"> · {detail}</span> : null}
      </span>
      {note && <span className="mx-mono mx-t-xs mx-muted">{note}</span>}
    </label>
  );
}

export function InvitePanel({ eventId, onDone }: { eventId: string; onDone?: () => void }) {
  const [tab, setTab] = useState<Tab>('contacts');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<InviteContactsResult | null>(null);
  const [counts, setCounts] = useState<InviteContactsResult['counts']>();
  const [startups, setStartups] = useState<InviteStartupOption[] | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupStatus, setStartupStatus] = useState('active');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedStartups, setPickedStartups] = useState<Set<string>>(new Set());
  const [state, setState] = useState<InvitationState | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();
  const req = useRef(0);

  // Kontaktboken: hämtas om när kategori eller sökning ändras (debounce).
  useEffect(() => {
    if (tab !== 'contacts') return;
    const id = ++req.current;
    const timer = setTimeout(
      () =>
        startLoading(async () => {
          const res = await listInviteContactsAction({ eventId, category, q, withCounts: !counts });
          if (id !== req.current) return;
          setContacts(res);
          if (res.counts) setCounts(res.counts);
        }),
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
    // counts behövs bara första gången — inte som beroende.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, category, q, tab]);

  useEffect(() => {
    if (tab !== 'startups' || startups) return;
    startLoading(async () => {
      const res = await listInviteStartupsAction({ eventId });
      setStartups(res.items);
      setStartupError(res.error ?? null);
    });
  }, [eventId, tab, startups]);

  const contactItems = contacts?.items ?? [];
  const selectableContacts = contactItems.filter((c) => c.hasEmail && !c.optedOut && !c.alreadyInvited);
  const allContactsPicked = selectableContacts.length > 0 && selectableContacts.every((c) => picked.has(c.id));

  const words = contactSearchWords(q);
  const startupStatuses = useMemo(
    () => [...new Set((startups ?? []).map((s) => s.status).filter(Boolean))],
    [startups]
  );
  const visibleStartups = (startups ?? []).filter(
    (s) => (!startupStatus || s.status === startupStatus) && matchesContactSearch([s.name], words)
  );
  const selectableStartups = visibleStartups.filter((s) => s.via !== 'none' && !s.alreadyInvited);
  const allStartupsPicked = selectableStartups.length > 0 && selectableStartups.every((s) => pickedStartups.has(s.id));

  const toggleAll = (current: Set<string>, set: (s: Set<string>) => void, ids: string[], on: boolean) => {
    const next = new Set(current);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    set(next);
  };

  const total = picked.size + pickedStartups.size;
  const submit = () => {
    const parts = [
      picked.size ? `${picked.size} ${picked.size === 1 ? 'kontakt' : 'kontakter'}` : '',
      pickedStartups.size ? `${pickedStartups.size} bolag` : ''
    ].filter(Boolean);
    if (!window.confirm(`Skicka inbjudan till ${parts.join(' och ')} nu?`)) return;
    startSending(async () => {
      const res = await inviteToEventAction({
        eventId,
        contactIds: [...picked.keys()],
        startupIds: [...pickedStartups.keys()]
      });
      setState(res);
      if (res.ok) {
        setPicked(new Set());
        setPickedStartups(new Set());
        // Läs om listorna så att de nyss inbjudna visas som "på listan".
        setStartups(null);
        setContacts(await listInviteContactsAction({ eventId, category, q }));
        onDone?.();
      }
    });
  };

  const contactNote = (c: InviteContactOption) =>
    c.alreadyInvited ? 'på listan' : c.optedOut ? 'avregistrerad' : !c.hasEmail ? 'saknar e-post' : '';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="mx-flex mx-gap-2" role="tablist">
        {(
          [
            ['contacts', 'Kontaktboken'],
            ['startups', 'Bolag']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`mx-btn mx-sm${tab === key ? ' mx-primary' : ''}`}
            onClick={() => {
              setTab(key);
              setQ('');
            }}
          >
            {label}
            {key === 'contacts' && picked.size > 0 ? ` (${picked.size})` : ''}
            {key === 'startups' && pickedStartups.size > 0 ? ` (${pickedStartups.size})` : ''}
          </button>
        ))}
      </div>

      <input
        className="mx-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tab === 'contacts' ? 'Sök namn, organisation eller e-post' : 'Sök bolag'}
        maxLength={120}
        aria-label="Sök"
      />

      {tab === 'contacts' ? (
        <>
          <div className="mx-flex mx-gap-2 mx-wrap">
            <FilterChip active={!category} onClick={() => setCategory('')}>
              Alla{counts ? ` (${counts.all})` : ''}
            </FilterChip>
            {CONTACT_CATEGORIES.map((c) => {
              const n = counts?.byCategory[c];
              if (counts && !n) return null;
              return (
                <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {CONTACT_CATEGORY_LABELS[c]}
                  {n ? ` (${n})` : ''}
                </FilterChip>
              );
            })}
          </div>
          {contacts?.error ? (
            <Notice state={{ error: contacts.error }} />
          ) : contacts && contactItems.length === 0 ? (
            <div className="mx-muted mx-t-13">Inga kontakter matchar.</div>
          ) : (
            <>
              <label className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-2">
                <input
                  type="checkbox"
                  checked={allContactsPicked}
                  disabled={selectableContacts.length === 0}
                  onChange={(e) => toggleAll(picked, setPicked, selectableContacts.map((c) => c.id), e.target.checked)}
                  style={{ accentColor: 'var(--movexum-morkbla)' }}
                />
                Välj alla {category && isContactCategory(category) ? CONTACT_CATEGORY_LABELS[category].toLowerCase() : 'i listan'} som kan
                bjudas in ({selectableContacts.length})
                {loading && <span className="mx-mono mx-t-xs">· laddar…</span>}
              </label>
              {contacts && contacts.total > contactItems.length && (
                <div className="mx-t-12 mx-muted">
                  Visar {contactItems.length} av {contacts.total} — sök eller välj en kategori för att smalna av.
                </div>
              )}
              <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid var(--mx-line-soft)' }}>
                {contactItems.map((c) => (
                  <Row
                    key={c.id}
                    checked={picked.has(c.id)}
                    disabled={!c.hasEmail || c.optedOut || c.alreadyInvited}
                    onChange={(on) => toggleAll(picked, setPicked, [c.id], on)}
                    title={c.name}
                    detail={[c.organization, isContactCategory(c.category) ? CONTACT_CATEGORY_LABELS[c.category] : '']
                      .filter(Boolean)
                      .join(' · ')}
                    note={contactNote(c)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mx-flex mx-gap-2 mx-wrap">
            <FilterChip active={!startupStatus} onClick={() => setStartupStatus('')}>
              Alla{startups ? ` (${startups.length})` : ''}
            </FilterChip>
            {startupStatuses.map((st) => (
              <FilterChip key={st} active={startupStatus === st} onClick={() => setStartupStatus(st)}>
                {STATUS_LABEL[st] ?? st} ({(startups ?? []).filter((s) => s.status === st).length})
              </FilterChip>
            ))}
          </div>
          {startupError ? (
            <Notice state={{ error: startupError }} />
          ) : !startups ? (
            <div className="mx-muted mx-t-13">Laddar bolag…</div>
          ) : visibleStartups.length === 0 ? (
            <div className="mx-muted mx-t-13">Inga bolag matchar.</div>
          ) : (
            <>
              <label className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-2">
                <input
                  type="checkbox"
                  checked={allStartupsPicked}
                  disabled={selectableStartups.length === 0}
                  onChange={(e) => toggleAll(pickedStartups, setPickedStartups, selectableStartups.map((s) => s.id), e.target.checked)}
                  style={{ accentColor: 'var(--movexum-morkbla)' }}
                />
                Välj alla bolag i listan ({selectableStartups.length})
              </label>
              <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid var(--mx-line-soft)' }}>
                {visibleStartups.map((s) => (
                  <Row
                    key={s.id}
                    checked={pickedStartups.has(s.id)}
                    disabled={s.via === 'none' || s.alreadyInvited}
                    onChange={(on) => toggleAll(pickedStartups, setPickedStartups, [s.id], on)}
                    title={s.name}
                    detail={STATUS_LABEL[s.status] ?? ''}
                    note={s.alreadyInvited ? 'inbjudet' : STARTUP_VIA[s.via](s.count)}
                  />
                ))}
              </div>
              <div className="mx-t-12 mx-muted">
                Ett bolag bjuds in via sina medlemmar i plattformen, annars bolagets huvudkontakter i kontaktboken,
                annars bolagets e-postadress.
              </div>
            </>
          )}
        </>
      )}

      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <button type="button" className="mx-btn mx-primary" disabled={sending || total === 0} onClick={submit}>
          <Icon name="send" size={12} />{' '}
          {sending
            ? 'Skickar…'
            : total === 0
              ? 'Bjud in och skicka'
              : `Bjud in och skicka (${[picked.size ? `${picked.size} kontakter` : '', pickedStartups.size ? `${pickedStartups.size} bolag` : ''].filter(Boolean).join(' + ')})`}
        </button>
        {total > 0 && (
          <button
            type="button"
            className="mx-btn mx-sm"
            onClick={() => {
              setPicked(new Set());
              setPickedStartups(new Set());
            }}
          >
            Rensa val
          </button>
        )}
      </div>
      <Notice state={state} />
      <div className="mx-t-12 mx-muted">
        Varje mejl har en personlig svarslänk. Kontakter i kontaktboken bjuds in på grund av berättigat intresse och
        kan avregistrera sig i varje mejl; den som avregistrerat sig kan inte väljas.
      </div>
    </div>
  );
}
