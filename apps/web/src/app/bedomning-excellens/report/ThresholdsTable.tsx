'use client';

import { SCREENING_NOTE_MAX, type CompanyAssessment, type ScreeningManualFacts, type ExcellenceScreeningResult, type ThresholdRow } from '@platform/shared';
import { CheckList, CheckRow, EditToggle, WARN_TONE, formatOrgNr, inputCls, numberOrUndefined, sek, sekM } from './shared';



/** Rader utan bokslut kan fyllas med bolagets egen uppskattning (bilaga I art. 4.3). */
const estimable = (r: ThresholdRow) => !!r.orgNr && (r.estimated || (!!r.note && r.year === undefined));

/**
 * Tröskelvärdena (sysselsättning, omsättning, balansomslutning — viktade per
 * relation), prövningen mot småföretagstaket och de minimis för "ett enda
 * företag", med intyg per anknutet bolag utan plattformsdata.
 */
export function ThresholdsTable({
  result,
  facts,
  setFacts,
  linkedForIntyg,
  editingIntyg,
  onToggleIntyg
}: {
  result: ExcellenceScreeningResult;
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
  linkedForIntyg: CompanyAssessment[];
  editingIntyg: boolean;
  onToggleIntyg: () => void;
}) {
  const setEstimate = (orgNr: string, patch: Record<string, number | string | undefined>) =>
    setFacts((f) => {
      const next = { ...(f.estimates[orgNr] ?? {}), ...patch } as Record<string, number | string | undefined>;
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
      const estimates = { ...f.estimates };
      if (Object.keys(next).length > 0) estimates[orgNr] = next as ScreeningManualFacts['estimates'][string];
      else delete estimates[orgNr];
      return { ...f, estimates };
    });
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-default">
        <table className="w-full text-[12.5px]">
          <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Namn</th>
              <th className="px-3 py-2 font-medium">Andel</th>
              <th className="px-3 py-2 font-medium">Bokslut</th>
              <th className="px-3 py-2 font-medium">Sysselsättning</th>
              <th className="px-3 py-2 font-medium">Årsomsättning</th>
              <th className="px-3 py-2 font-medium">Balansomslutning</th>
            </tr>
          </thead>
          <tbody>
            {result.thresholds.rows.map((r) => {
              const canEstimate = estimable(r);
              const est = canEstimate ? facts.estimates[r.orgNr] : undefined;
              const label = r.name || formatOrgNr(r.orgNr);
              const numCell = (key: 'employees' | 'revenue_sek' | 'balance_sheet_sek', placeholder: string, shown?: number) =>
                canEstimate ? (
                  <input
                    aria-label={`${label} — ${placeholder} (uppskattning)`}
                    inputMode="decimal"
                    placeholder={placeholder}
                    value={est?.[key] ?? ''}
                    onChange={(e) => setEstimate(r.orgNr, { [key]: numberOrUndefined(e.target.value) })}
                    className={`${inputCls} min-w-24 mx-tnum`}
                  />
                ) : key === 'employees' ? (
                  (shown ?? '–')
                ) : (
                  sek(shown)
                );
              return (
                <tr key={r.orgNr || r.name} className="border-t border-default align-top">
                  <td className="px-3 py-1.5 text-foreground">
                    {label}
                    {r.note && !canEstimate ? <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${WARN_TONE}`}>{r.note}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                    {r.role === 'subject' ? 'Startup' : r.role === 'linked' ? '100 % (anknutet)' : `${Math.round(r.weight * 100)} % (partner)`}
                  </td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                    {canEstimate ? (
                      <input
                        aria-label={`${label} — källa för uppskattningen`}
                        placeholder={r.note ? `${r.note} — källa` : 'Uppskattning — källa'}
                        maxLength={SCREENING_NOTE_MAX}
                        value={est?.note ?? ''}
                        onChange={(e) => setEstimate(r.orgNr, { note: e.target.value })}
                        className={`${inputCls} min-w-36`}
                      />
                    ) : (
                      (r.year ?? '–')
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('employees', 'Anställda', r.employees)}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('revenue_sek', 'Omsättning kr', r.revenue_sek)}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('balance_sheet_sek', 'Balansomslutning kr', r.balance_sheet_sek)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-strong bg-canvas-subtle font-semibold">
              <td className="px-3 py-1.5 text-foreground">Sammanlagt{result.thresholds.combined.complete ? '' : ' (ofullständigt)'}</td>
              <td className="px-3 py-1.5 text-foreground-muted">Tak: 50 · 10 M€ · 10 M€</td>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5 text-foreground mx-tnum">{result.thresholds.combined.employees ?? '–'}</td>
              <td className="px-3 py-1.5 text-foreground mx-tnum">{sekM(result.thresholds.combined.revenue_sek)}</td>
              <td className="px-3 py-1.5 text-foreground mx-tnum">{sekM(result.thresholds.combined.balance_sheet_sek)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <CheckList>
          <CheckRow check={result.thresholds.check} />
          <CheckRow check={result.deMinimis} />
          {linkedForIntyg.length > 0 && (
            <li className="px-4 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground-muted">
                <span>
                  De minimis-intyg för anknutna bolag (EUR, innevarande + två år bakåt):{' '}
                  {linkedForIntyg
                    .map((c) => `${c.name || formatOrgNr(c.orgNr)} ${facts.de_minimis_related[c.orgNr] ? `${facts.de_minimis_related[c.orgNr].used_eur.toLocaleString('sv-SE')} €` : '–'}`)
                    .join(' · ')}
                </span>
                <EditToggle editing={editingIntyg} onToggle={onToggleIntyg} label="Ange intyg" />
              </p>
              {editingIntyg && (
                <div className="mt-2 space-y-1.5">
                  {linkedForIntyg.map((c) => {
                    const row = facts.de_minimis_related[c.orgNr];
                    const label = c.name || formatOrgNr(c.orgNr);
                    return (
                      <div key={c.orgNr} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)] sm:items-center">
                        <p className="text-[12.5px] font-medium text-foreground">{label}</p>
                        <input
                          aria-label={`${label} — de minimis EUR`}
                          inputMode="numeric"
                          placeholder="EUR"
                          value={row ? String(row.used_eur) : ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\s/g, '');
                            setFacts((f) => {
                              const next = { ...f.de_minimis_related };
                              if (v === '' || !/^\d+$/.test(v)) delete next[c.orgNr];
                              else next[c.orgNr] = { ...(next[c.orgNr] ?? { used_eur: 0 }), used_eur: Number(v) };
                              return { ...f, de_minimis_related: next };
                            });
                          }}
                          className={`${inputCls} mx-tnum`}
                        />
                        <input
                          aria-label={`${label} — intygets referens`}
                          placeholder="Intygets datum/referens"
                          disabled={!row}
                          maxLength={SCREENING_NOTE_MAX}
                          value={row?.note ?? ''}
                          onChange={(e) =>
                            setFacts((f) => ({
                              ...f,
                              de_minimis_related: { ...f.de_minimis_related, [c.orgNr]: { used_eur: row?.used_eur ?? 0, note: e.target.value || undefined } }
                            }))
                          }
                          className={`${inputCls} disabled:opacity-50`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          )}
        </CheckList>
      </div>
    </div>
  );
}
