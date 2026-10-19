'use client';

import { MATURITY_PHASES, MATURITY_PHASE_LABEL, SCREENING_MAX_FOUNDERS, type ScreeningFounderFact, type ScreeningManualFacts } from '@platform/shared';
import { EditToggle, inputCls, numberOrUndefined, pctText } from './shared';

/** Grundarteamet (namn, andel, engagemang, forskare) + mognadsfas och forskningsavknoppning — redigeras i sin helhet. */
export function FoundersTable({
  rows,
  setRows,
  facts,
  setFacts,
  foundersSource,
  editing,
  onToggle
}: {
  rows: ScreeningFounderFact[];
  setRows: (rows: ScreeningFounderFact[]) => void;
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
  foundersSource?: string;
  editing: boolean;
  onToggle: () => void;
}) {
  const sourceLabel = facts.founders ? 'manuellt inmatat' : foundersSource === 'platform' && rows.length > 0 ? 'ur teamet på bolagskortet' : 'inte angivet';
  return (
    <div className="overflow-x-auto rounded-xl border border-default">
      <table className="w-full text-[12.5px]">
        <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Grundarteamet ({sourceLabel})
              {!editing && facts.maturity_phase ? ` · fas: ${MATURITY_PHASE_LABEL[facts.maturity_phase]}` : ''}
              {!editing && facts.research_spinoff ? ' · forskningsavknoppning' : ''}
            </span>
            <EditToggle editing={editing} onToggle={onToggle} label="Ändra" />
          </span>
        </caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
          <tr className="border-t border-default">
            <th className="px-3 py-1.5 font-medium">Namn</th>
            <th className="px-3 py-1.5 font-medium">% kapital</th>
            <th className="px-3 py-1.5 font-medium">Engagemang (% av heltid)</th>
            <th className="px-3 py-1.5 font-medium">Forskare</th>
            {editing && <th className="px-3 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) =>
            editing ? (
              <tr key={i} className="border-t border-default">
                <td className="px-2 py-1">
                  <input aria-label="Grundarens namn" value={f.name} maxLength={120} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} />
                </td>
                <td className="px-2 py-1">
                  <input
                    aria-label="Ägarandel i procent"
                    inputMode="decimal"
                    value={f.equity_pct ?? ''}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, equity_pct: numberOrUndefined(e.target.value) } : x)))}
                    className={`${inputCls} mx-tnum`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    aria-label="Engagemang i procent av heltid"
                    inputMode="decimal"
                    value={f.engagement_pct ?? ''}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, engagement_pct: numberOrUndefined(e.target.value) } : x)))}
                    className={`${inputCls} mx-tnum`}
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" aria-label="Forskare" checked={f.researcher === true} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, researcher: e.target.checked || undefined } : x)))} />
                </td>
                <td className="px-2 py-1 text-right">
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground">
                    Ta bort
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={i} className="border-t border-default">
                <td className="px-3 py-1.5 text-foreground">{f.name || <span className="text-foreground-subtle">(namn saknas)</span>}</td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.equity_pct)}</td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.engagement_pct)}</td>
                <td className="px-3 py-1.5 text-foreground-muted">{f.researcher ? 'Ja' : ''}</td>
              </tr>
            )
          )}
          {rows.length === 0 && (
            <tr className="border-t border-default">
              <td colSpan={editing ? 5 : 4} className="px-3 py-2 text-foreground-muted">
                Inga grundare angivna.
              </td>
            </tr>
          )}
          {editing && (
            <tr className="border-t border-default bg-canvas-subtle">
              <td colSpan={5} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={rows.length >= SCREENING_MAX_FOUNDERS}
                    onClick={() => setRows([...rows, { name: '' }])}
                    className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-50"
                  >
                    + Lägg till grundare
                  </button>
                  {facts.founders && foundersSource === 'platform' && (
                    <button type="button" onClick={() => setFacts((f) => ({ ...f, founders: undefined }))} className="text-[12px] font-semibold text-link hover:underline">
                      Återgå till teamet på bolagskortet
                    </button>
                  )}
                  <label className="flex items-center gap-2 text-[12.5px] text-foreground">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Mognadsfas</span>
                    <select
                      value={facts.maturity_phase ?? ''}
                      onChange={(e) => setFacts((f) => ({ ...f, maturity_phase: (e.target.value || undefined) as ScreeningManualFacts['maturity_phase'] }))}
                      className={inputCls}
                    >
                      <option value="">Inte angiven</option>
                      {MATURITY_PHASES.map((p) => (
                        <option key={p} value={p}>
                          {MATURITY_PHASE_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px] text-foreground">
                    <input type="checkbox" checked={facts.research_spinoff === true} onChange={(e) => setFacts((f) => ({ ...f, research_spinoff: e.target.checked || undefined }))} />
                    Forskningsavknoppning
                  </label>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
