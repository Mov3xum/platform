'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { RECORD_DIRECTION_LABELS, RECORD_DIRECTIONS, REGISTER_VIA_LABELS } from '@platform/shared';
import type { RegisterEntryView } from '@/lib/register/data';
import { registerManualEntryAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, Notice, btnGhost, btnPrimary, card, formatRegisterDate, inputClass, labelClass } from '@/components/register/ui';

interface Filter {
  q: string;
  year: string;
  type: string;
  direction: string;
  secrecy: boolean;
}

interface Props {
  entries: RegisterEntryView[];
  total: number;
  page: number;
  pages: number;
  filter: Filter;
  types: { key: string; label: string }[];
  registerable: { key: string; label: string; secrecyPossible: boolean; secrecyBasis: string }[];
  canRegister: boolean;
  readError: string | null;
}

function query(filter: Filter, page?: number): string {
  const p = new URLSearchParams();
  if (filter.q) p.set('q', filter.q);
  if (filter.year) p.set('ar', filter.year);
  if (filter.type) p.set('typ', filter.type);
  if (filter.direction) p.set('riktning', filter.direction);
  if (filter.secrecy) p.set('sekretess', '1');
  if (page && page > 1) p.set('sida', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function ManualEntryForm({ registerable, caseId, onDone }: { registerable: Props['registerable']; caseId?: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState<RegisterActionState, FormData>(registerManualEntryAction, {});
  // Manuell registrering gäller oftast brev och e-post — inte de typer som systemet registrerar självt.
  const initialKey = (registerable.find((t) => t.key === 'incoming_other') ?? registerable[0])?.key ?? '';
  const [typeKey, setTypeKey] = useState(initialKey);
  const type = registerable.find((t) => t.key === typeKey);
  const initialSecrecy = registerable.find((t) => t.key === initialKey)?.secrecyPossible ?? false;
  const [secrecy, setSecrecy] = useState(initialSecrecy);
  // React återställer formuläret efter en lyckad action — håll state i takt med fälten.
  const onReset = () => {
    setTypeKey(initialKey);
    setSecrecy(initialSecrecy);
  };
  return (
    <form action={action} onReset={onReset} className={`${card} space-y-4 p-5`}>
      {caseId && <input type="hidden" name="case_id" value={caseId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Handlingstyp</span>
          <select
            name="type_key"
            className={inputClass}
            defaultValue={initialKey}
            onChange={(e) => {
              setTypeKey(e.target.value);
              setSecrecy(registerable.find((t) => t.key === e.target.value)?.secrecyPossible ?? false);
            }}
          >
            {registerable.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Handlingens datum</span>
          <input type="date" name="document_date" className={inputClass} />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>Vad handlingen rör</span>
          <input name="title" required minLength={3} maxLength={200} className={inputClass} placeholder="T.ex. Brev från Region Gävleborg om ägardirektiv" />
        </label>
        <label className="block">
          <span className={labelClass}>Från / till (organisation)</span>
          <input name="counterpart" maxLength={160} className={inputClass} />
        </label>
        {!caseId && (
          <label className="block">
            <span className={labelClass}>Ärendemening (om nytt ärende)</span>
            <input name="case_title" maxLength={200} className={inputClass} placeholder="Lämna tomt för samma som handlingen" />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" name="secrecy" key={typeKey} defaultChecked={secrecy} onChange={(e) => setSecrecy(e.target.checked)} />
          Kan innehålla sekretessbelagda uppgifter
        </label>
        {secrecy && (
          <label className="block sm:col-span-2">
            <span className={labelClass}>Lagrum / grund</span>
            <input name="secrecy_basis" maxLength={300} defaultValue={type?.secrecyBasis ?? ''} key={typeKey} className={inputClass} />
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className={labelClass}>Anteckning (valfri)</span>
          <input name="note" maxLength={500} className={inputClass} placeholder="Var originalet finns, t.ex. pärm eller e-postlåda" />
        </label>
      </div>
      <ActionNotice state={state} />
      {state.ok && state.caseId && (
        <Link href={`/diarium/${state.caseId}`} className="text-sm text-link hover:underline">
          Öppna ärendet
        </Link>
      )}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={pending || registerable.length === 0}>
          {pending ? 'Registrerar…' : 'Registrera handling'}
        </button>
        {onDone && (
          <button type="button" className={btnGhost} onClick={onDone}>
            Stäng
          </button>
        )}
      </div>
    </form>
  );
}

export function RegisterList({ entries, total, page, pages, filter, types, registerable, canRegister, readError }: Props) {
  const [adding, setAdding] = useState(false);
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));
  const active = Boolean(filter.q || filter.year || filter.type || filter.direction || filter.secrecy);
  return (
    <div className="space-y-4">
      {readError && <Notice tone="bad">{readError}</Notice>}
      <div className="flex flex-wrap items-end gap-3">
        <form method="get" action="/diarium" className="flex flex-1 flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className={labelClass}>Sök</span>
            <input name="q" defaultValue={filter.q} placeholder="Diarienummer, ärende, motpart" className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>År</span>
            <select name="ar" defaultValue={filter.year} className={inputClass}>
              <option value="">Alla</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Typ</span>
            <select name="typ" defaultValue={filter.type} className={`${inputClass} max-w-[220px]`}>
              <option value="">Alla</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Riktning</span>
            <select name="riktning" defaultValue={filter.direction} className={inputClass}>
              <option value="">Alla</option>
              {RECORD_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {RECORD_DIRECTION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground-muted">
            <input type="checkbox" name="sekretess" value="1" defaultChecked={filter.secrecy} />
            Sekretess
          </label>
          <button className={btnGhost}>Filtrera</button>
          {active && (
            <Link href="/diarium" className="pb-2 text-sm text-link hover:underline">
              Rensa
            </Link>
          )}
        </form>
        <div className="flex gap-2">
          <a href={`/api/diarium/export${query(filter)}`} className={btnGhost}>
            Exportera CSV
          </a>
          {canRegister && !adding && (
            <button className={btnPrimary} onClick={() => setAdding(true)}>
              Registrera handling
            </button>
          )}
        </div>
      </div>

      {adding && <ManualEntryForm registerable={registerable} onDone={() => setAdding(false)} />}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
          {active ? 'Inga handlingar matchar filtret.' : 'Inga handlingar är registrerade än. De registreras automatiskt när en ansökan skickas in, ett avtal signeras, en lead kommer in eller ett beslut fattas.'}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-default text-xs text-foreground-subtle">
                <th className="px-4 py-2.5 font-semibold">Diarienr</th>
                <th className="px-3 py-2.5 font-semibold">Registrerad</th>
                <th className="px-3 py-2.5 font-semibold">Handling</th>
                <th className="px-3 py-2.5 font-semibold">Från / till</th>
                <th className="px-3 py-2.5 font-semibold">Riktning</th>
                <th className="px-3 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {entries.map((e) => (
                <tr key={e.id} className={e.voided ? 'opacity-60' : undefined}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/diarium/${e.caseId}#h-${e.id}`} className="mx-tnum font-semibold text-link hover:underline">
                      {e.designation}
                    </Link>
                  </td>
                  <td className="mx-tnum whitespace-nowrap px-3 py-2.5 text-foreground-muted">{formatRegisterDate(e.registeredAt)}</td>
                  <td className="px-3 py-2.5">
                    <div className={`text-foreground ${e.voided ? 'line-through' : ''}`}>{e.title}</div>
                    <div className="text-xs text-foreground-subtle">{e.typeLabel}</div>
                  </td>
                  <td className="px-3 py-2.5 text-foreground-muted">{e.counterpart || '–'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-foreground-muted">{RECORD_DIRECTION_LABELS[e.direction]}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1">
                      {e.voided && <Chip tone="bad">Makulerad</Chip>}
                      {e.secrecy && <Chip tone="warn">Sekretess</Chip>}
                      {e.via !== 'auto' && <Chip>{REGISTER_VIA_LABELS[e.via]}</Chip>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-foreground-muted">
          <span>
            Sida {page} av {pages} · {total} handlingar
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className={btnGhost} href={`/diarium${query(filter, page - 1)}`}>
                Föregående
              </Link>
            )}
            {page < pages && (
              <Link className={btnGhost} href={`/diarium${query(filter, page + 1)}`}>
                Nästa
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
