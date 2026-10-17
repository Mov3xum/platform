'use client';

import { actionErrorMessage } from '@/lib/action-error';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import {
  inviteToEventAction,
  listInviteOptionsAction,
  type InvitationState,
  type InviteListMeta,
  type InviteOption,
  type InviteOptionsResult
} from '@/lib/actions/invitations';
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS, splitInviteSelection } from '@platform/shared';

// Inbjudningspanelen (CLAUDE.md § 53.5) — samma på eventsidan och under
// Marknadsverktyg → Inbjudningar. En dropdown väljer listan (alla personer,
// kontaktboken, en kategori, en egen grupp, Movexum-personalen,
// bolagsmedlemmarna eller bolagen); sök och kryssa i. Urvalet följer med när
// listan byts, och ETT utskick skickar allt. Listorna hämtas dynamiskt och
// innehåller aldrig e-postadresser — bara om mottagaren går att nå.

const KIND_LABEL: Record<InviteOption['kind'], string> = { contact: 'Kontakt', user: 'Användare', startup: 'Bolag' };

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

function ListSelect({ value, onChange, meta }: { value: string; onChange: (v: string) => void; meta?: InviteListMeta }) {
  const n = (v: number | undefined) => (meta && v !== undefined ? ` (${v})` : '');
  return (
    <select className="mx-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Vilka vill du bjuda in?">
      <option value="everyone">Alla personer — sök överallt</option>
      <optgroup label="Kontaktboken">
        <option value="contacts">Hela kontaktboken{n(meta?.contacts)}</option>
        {CONTACT_CATEGORIES.map((c) => {
          const count = meta?.byCategory[c];
          if (meta && !count) return null;
          return (
            <option key={c} value={`cat:${c}`}>
              {CONTACT_CATEGORY_LABELS[c]}
              {n(count)}
            </option>
          );
        })}
      </optgroup>
      {meta && meta.groups.length > 0 && (
        <optgroup label="Egna grupper">
          {meta.groups.map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {g.name} ({g.count})
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Plattformen">
        <option value="staff">Movexum-personal{n(meta?.staff)}</option>
        <option value="members">Bolagsmedlemmar{n(meta?.members)}</option>
        <option value="startups">Bolag{n(meta?.startups)}</option>
      </optgroup>
    </select>
  );
}

function Row({ item, checked, onChange }: { item: InviteOption; checked: boolean; onChange: (on: boolean) => void }) {
  const disabled = !item.selectable;
  return (
    <label
      className="mx-t-13 mx-flex mx-items-c mx-gap-2"
      style={{
        padding: '7px 6px',
        borderBottom: '1px solid var(--mx-line-soft)',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-brand)', width: 16, height: 16 }}
      />
      <span style={{ flex: 1, minWidth: 0 }} className="mx-truncate">
        {item.name}
        {item.detail ? <span className="mx-muted"> · {item.detail}</span> : null}
      </span>
      {item.note ? (
        <span className="mx-mono mx-t-xs mx-muted">{item.note}</span>
      ) : (
        <span className="mx-mono mx-t-xs mx-muted">{KIND_LABEL[item.kind]}</span>
      )}
    </label>
  );
}

export function InvitePanel({ eventId, onDone }: { eventId: string; onDone?: () => void }) {
  const [list, setList] = useState('everyone');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<InviteOptionsResult | null>(null);
  const [meta, setMeta] = useState<InviteListMeta>();
  const [startupStatus, setStartupStatus] = useState('');
  /** Valda mottagare: nyckel → visningsnamn (för chipsen). */
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<InvitationState | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();
  const [reload, setReload] = useState(0);
  const req = useRef(0);
  /** Räknarna i dropdownen hämtas första gången och efter varje utskick. */
  const needMeta = useRef(true);

  useEffect(() => {
    const id = ++req.current;
    const timer = setTimeout(
      () =>
        startLoading(async () => {
          let res: InviteOptionsResult;
          try {
            res = await listInviteOptionsAction({ eventId, list, q, withMeta: needMeta.current });
          } catch (err) {
            res = { error: actionErrorMessage(err, 'Kunde inte läsa listan. Ladda om sidan och försök igen.'), items: [], total: 0 };
          }
          if (id !== req.current) return;
          setResult(res);
          if (res.meta) {
            setMeta(res.meta);
            needMeta.current = false;
          }
        }),
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [eventId, list, q, reload]);

  const items = useMemo(() => {
    const all = result?.items ?? [];
    return list === 'startups' && startupStatus ? all.filter((i) => i.detail === startupStatus) : all;
  }, [result, list, startupStatus]);
  const statuses = useMemo(
    () => (list === 'startups' ? [...new Set((result?.items ?? []).map((i) => i.detail).filter(Boolean))] : []),
    [result, list]
  );
  const selectable = items.filter((i) => i.selectable);
  const allPicked = selectable.length > 0 && selectable.every((i) => picked.has(i.key));

  const toggle = (entries: InviteOption[], on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const i of entries) {
        if (on) next.set(i.key, i.name);
        else next.delete(i.key);
      }
      return next;
    });

  const split = splitInviteSelection(picked.keys());
  const summary = [
    split.contactIds.length ? `${split.contactIds.length} ${split.contactIds.length === 1 ? 'kontakt' : 'kontakter'}` : '',
    split.userIds.length ? `${split.userIds.length} användare` : '',
    split.startupIds.length ? `${split.startupIds.length} bolag` : ''
  ].filter(Boolean);

  const submit = () => {
    if (!window.confirm(`Skicka inbjudan till ${summary.join(', ')} nu?`)) return;
    startSending(async () => {
      let res: InvitationState;
      try {
        res = await inviteToEventAction({ eventId, selection: [...picked.keys()] });
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Inbjudan kunde inte skickas. Ladda om sidan och försök igen.') };
      }
      setState(res);
      if (res.ok) {
        setPicked(new Map());
        // Läs om listan så att de nyss inbjudna visas som "på listan".
        needMeta.current = true;
        setReload((n) => n + 1);
        onDone?.();
      }
    });
  };

  const chips = [...picked.entries()];
  const listLabel = list.startsWith('cat:') ? CONTACT_CATEGORY_LABELS[list.slice(4) as keyof typeof CONTACT_CATEGORY_LABELS]?.toLowerCase() : '';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
        <ListSelect
          value={list}
          meta={meta}
          onChange={(v) => {
            setList(v);
            setStartupStatus('');
          }}
        />
        <input
          className="mx-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={list === 'startups' ? 'Sök bolag' : 'Sök namn, organisation eller e-post'}
          maxLength={120}
          aria-label="Sök"
        />
      </div>

      {list === 'startups' && statuses.length > 1 && (
        <select
          className="mx-input"
          value={startupStatus}
          onChange={(e) => setStartupStatus(e.target.value)}
          aria-label="Bolagsstatus"
          style={{ maxWidth: 240 }}
        >
          <option value="">Alla bolag</option>
          {statuses.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      )}

      {meta?.warning && <div className="mx-t-12 mx-muted">{meta.warning}</div>}
      {result?.warning && <div className="mx-t-12 mx-muted">{result.warning}</div>}

      {result?.error ? (
        <Notice state={{ error: result.error }} />
      ) : (
        <>
          <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
            <label className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-2">
              <input
                type="checkbox"
                checked={allPicked}
                disabled={selectable.length === 0}
                onChange={(e) => toggle(selectable, e.target.checked)}
                style={{ accentColor: 'var(--color-brand)', width: 16, height: 16 }}
              />
              Välj alla {listLabel || 'i listan'} som kan bjudas in ({selectable.length})
            </label>
            {loading && <span className="mx-mono mx-t-xs mx-muted">laddar…</span>}
            <span style={{ flex: 1 }} />
            <Link href="/kontakter/grupper" className="mx-t-12" style={{ color: 'var(--color-link)' }}>
              Hantera grupper
            </Link>
          </div>
          {result && result.total > (result.items?.length ?? 0) && (
            <div className="mx-t-12 mx-muted">
              Visar {result.items.length} av {result.total} — sök eller välj en kategori/grupp för att smalna av.
            </div>
          )}
          <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid var(--mx-line-soft)' }}>
            {result && items.length === 0 ? (
              <div className="mx-muted mx-t-13" style={{ padding: '12px 4px' }}>
                {q ? `Ingen träff på "${q}" i den här listan.` : 'Listan är tom.'}
                {q && list !== 'everyone' && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="mx-t-13"
                      style={{ color: 'var(--color-link)', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      onClick={() => setList('everyone')}
                    >
                      Sök bland alla personer
                    </button>
                  </>
                )}
              </div>
            ) : (
              items.map((item) => (
                <Row key={item.key} item={item} checked={picked.has(item.key)} onChange={(on) => toggle([item], on)} />
              ))
            )}
          </div>
        </>
      )}

      {chips.length > 0 && (
        <div className="mx-flex mx-gap-2 mx-wrap" aria-label="Valda mottagare">
          {chips.slice(0, 12).map(([key, name]) => (
            <span key={key} className="mx-chip mx-draft mx-flex mx-items-c mx-gap-1">
              {name}
              <button
                type="button"
                aria-label={`Ta bort ${name}`}
                onClick={() => setPicked((prev) => new Map([...prev].filter(([k]) => k !== key)))}
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
          {chips.length > 12 && <span className="mx-t-12 mx-muted">+{chips.length - 12} till</span>}
        </div>
      )}

      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <button type="button" className="mx-btn mx-primary" disabled={sending || picked.size === 0} onClick={submit}>
          <Icon name="send" size={12} />{' '}
          {sending ? 'Skickar…' : picked.size === 0 ? 'Bjud in och skicka' : `Bjud in och skicka (${summary.join(' + ')})`}
        </button>
        {picked.size > 0 && (
          <button type="button" className="mx-btn mx-sm" onClick={() => setPicked(new Map())}>
            Rensa val
          </button>
        )}
      </div>
      <Notice state={state} />
      <div className="mx-t-12 mx-muted">
        Varje mejl har en personlig svarslänk. Kontakter i kontaktboken bjuds in på grund av berättigat intresse och
        kan avregistrera sig i varje mejl; den som avregistrerat sig kan inte väljas. Ett bolag bjuds in via sina
        medlemmar i plattformen, annars bolagets huvudkontakter, annars bolagets e-postadress.
      </div>
    </div>
  );
}
