'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteStodAction } from '@/lib/actions/de-minimis';
import { Icon } from '@/components/proto/Icon';
import { FORORDNING_KODER, forordningLabels, type ForordningKod } from '@platform/shared';

export interface StodRow {
  id: string;
  forordning: ForordningKod;
  stodgivare: string;
  beslutsdatum: string;
  belopp_eur: number;
  belopp_sek?: number;
  valutakurs?: number;
  beslut_referens?: string;
  syfte?: string;
  registrerad_i_eair?: boolean;
  dokumentUrl?: string | null;
}

function eur(n: number): string {
  return `${Math.round(n).toLocaleString('sv-SE')} EUR`;
}

function svDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : d.toLocaleDateString('sv-SE');
}

function DeleteStodButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const onClick = () => {
    if (!window.confirm('Ta bort denna stödpost? Detta går inte att ångra.')) return;
    startTransition(async () => {
      const res = await deleteStodAction(id);
      if (res.error) {
        window.alert(res.error);
        return;
      }
      router.refresh();
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded-full border border-default px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
      aria-label="Ta bort stödpost"
    >
      <Icon name="trash" size={12} /> {isPending ? 'Tar bort…' : 'Ta bort'}
    </button>
  );
}

export function StodList({ rows, canManage }: { rows: StodRow[]; canManage: boolean }) {
  const [filter, setFilter] = useState<'ALL' | ForordningKod>('ALL');
  const [fromDate, setFromDate] = useState('');

  const filtered = useMemo(() => {
    return rows
      .filter((r) => (filter === 'ALL' ? true : r.forordning === filter))
      .filter((r) => (fromDate ? r.beslutsdatum.slice(0, 10) >= fromDate : true))
      .sort((a, b) => b.beslutsdatum.localeCompare(a.beslutsdatum));
  }, [rows, filter, fromDate]);

  const selectClass =
    'rounded-lg border border-default bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-strong';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'ALL' | ForordningKod)}
          className={selectClass}
          aria-label="Filtrera på förordning"
        >
          <option value="ALL">Alla förordningar</option>
          {FORORDNING_KODER.map((kod) => (
            <option key={kod} value={kod}>
              {forordningLabels[kod]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-foreground-subtle">
          Från
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={selectClass}
          />
        </label>
        {fromDate ? (
          <button
            type="button"
            onClick={() => setFromDate('')}
            className="text-xs font-medium text-link hover:underline"
          >
            Rensa
          </button>
        ) : null}
        <span className="ml-auto text-xs text-foreground-subtle">{filtered.length} st</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-default p-6 text-center text-sm text-foreground-subtle">
          Inga stöd registrerade {filter === 'ALL' ? '' : `för ${forordningLabels[filter as ForordningKod]}`}.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id} className="rounded-xl border border-default p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.stodgivare}</span>
                    <span className="rounded-full bg-canvas-muted px-2 py-0.5 font-mono text-[11px] text-foreground-muted">
                      {forordningLabels[r.forordning]}
                    </span>
                    {r.registrerad_i_eair ? (
                      <span className="rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-[11px] text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla">
                        eAir
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Beslut {svDate(r.beslutsdatum)}
                    {r.beslut_referens ? ` · Ref: ${r.beslut_referens}` : ''}
                  </p>
                  {r.syfte ? <p className="mt-1 text-xs text-foreground-muted">{r.syfte}</p> : null}
                  {r.belopp_sek ? (
                    <p className="mt-1 text-[11px] text-foreground-subtle">
                      {Math.round(r.belopp_sek).toLocaleString('sv-SE')} SEK
                      {r.valutakurs ? ` · kurs ${r.valutakurs}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">{eur(r.belopp_eur)}</span>
                  <div className="flex items-center gap-2">
                    {r.dokumentUrl ? (
                      <a
                        href={r.dokumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline"
                      >
                        <Icon name="download" size={12} /> Beslut
                      </a>
                    ) : null}
                    {canManage ? <DeleteStodButton id={r.id} /> : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
