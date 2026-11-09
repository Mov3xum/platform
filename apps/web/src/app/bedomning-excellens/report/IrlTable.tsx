'use client';

import Link from 'next/link';
import { IRL_AXES, SCREENING_NOTE_MAX, type ScreeningManualFacts, type ExcellenceScreeningResult } from '@platform/shared';
import { EditToggle, IRL_LABEL, KTH_EXTRA_AXES, inputCls } from './shared';

/**
 * IRL-tabellen: bolagskortets KTH-bedömning är facit per axel (§ 51.11);
 * nivåer och motiveringar som anges här flyttas till bolagskortet vid sparning.
 */
export function IrlTable({
  irl,
  facts,
  setFacts,
  startupId,
  editing,
  onToggle
}: {
  irl: ExcellenceScreeningResult['irl'];
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
  startupId?: string;
  editing: boolean;
  onToggle: () => void;
}) {
  const platformIrl = !!irl && !irl.manualLevels && IRL_AXES.some((ax) => typeof irl[ax] === 'number');
  const setIrl = (patch: Partial<NonNullable<ScreeningManualFacts['irl']>>) => setFacts((f) => ({ ...f, irl: { ...(f.irl ?? {}), ...patch } }));
  return (
    <div className="overflow-x-auto rounded-xl border border-default">
      <table className="w-full text-[12.5px]">
        <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Bedömning IRL{irl?.assessedAt ? ` (senast ${irl.assessedAt})` : ''}
              {typeof irl?.level === 'number' ? ` · sammanvägd nivå ${irl.level}` : ''}
              {irl?.manualLevels ? ' · nivåer manuellt angivna' : platformIrl ? ' · från bolagskortet' : ''}
            </span>
            <span className="flex items-center gap-3">
              {startupId && (
                <Link href={`/startups/${startupId}/utveckling#irl`} className="text-[12px] font-semibold text-link hover:underline">
                  IRL på bolagskortet
                </Link>
              )}
              <EditToggle editing={editing} onToggle={onToggle} label="Ändra" />
            </span>
          </span>
        </caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
          <tr className="border-t border-default">
            <th className="px-3 py-1.5 font-medium">Kategori</th>
            <th className="px-3 py-1.5 font-medium">Nivå</th>
            <th className="px-3 py-1.5 font-medium">Motivering (metrics)</th>
          </tr>
        </thead>
        <tbody>
          {IRL_AXES.map((ax) => {
            // Resultatet är facit: bolagskortets nivå per axel, annars manuellt angiven.
            const level = irl?.[ax];
            const note = facts.irl?.notes?.[ax] ?? irl?.notes?.[ax];
            return (
              <tr key={ax} className="border-t border-default">
                <td className="px-3 py-1.5 font-medium text-foreground">{IRL_LABEL[ax]}</td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                  {editing ? (
                    <input
                      aria-label={`${IRL_LABEL[ax]} nivå`}
                      inputMode="numeric"
                      placeholder={typeof level === 'number' ? String(level) : '1–9'}
                      value={facts.irl?.levels?.[ax] ?? ''}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        const levels = { ...(facts.irl?.levels ?? {}) };
                        if (e.target.value === '' || !Number.isInteger(n)) delete levels[ax];
                        else levels[ax] = n;
                        setIrl({ levels });
                      }}
                      className={`${inputCls} w-20 mx-tnum`}
                    />
                  ) : typeof level === 'number' ? (
                    level
                  ) : (
                    '–'
                  )}
                </td>
                <td className={`px-3 py-1.5 ${note ? 'text-foreground' : 'text-foreground-subtle'}`}>
                  {editing ? (
                    <input
                      aria-label={`${IRL_LABEL[ax]} motivering`}
                      placeholder={irl?.notes?.[ax] ?? 'Motivering (metrics)'}
                      maxLength={SCREENING_NOTE_MAX}
                      value={facts.irl?.notes?.[ax] ?? ''}
                      onChange={(e) => {
                        const notes = { ...(facts.irl?.notes ?? {}) };
                        if (e.target.value) notes[ax] = e.target.value;
                        else delete notes[ax];
                        setIrl({ notes });
                      }}
                      className={inputCls}
                    />
                  ) : (
                    (note ?? (platformIrl ? 'Motivering saknas' : 'Ingen readiness-bedömning i plattformen'))
                  )}
                </td>
              </tr>
            );
          })}
          {KTH_EXTRA_AXES.filter((k) => typeof irl?.[k.key] === 'number').map((k) => (
            <tr key={k.key} className="border-t border-default">
              <td className="px-3 py-1.5 font-medium text-foreground">{k.label}</td>
              <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{irl?.[k.key]}</td>
              <td className="px-3 py-1.5 text-foreground-subtle">{k.hint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
