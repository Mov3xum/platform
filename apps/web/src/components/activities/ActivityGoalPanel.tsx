'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import {
  ACTIVITY_MEASURE_LABELS,
  ACTIVITY_OUTCOME_LABELS,
  formatStockholmDateTime,
  isActivityMeasure,
  type ActivityOutcome
} from '@platform/shared';
import {
  completeActivityAction,
  saveActivityGoalsAction,
  type ActivityGoalState
} from '@/lib/actions/activity-goals';
import type { ActivityIndicatorOption } from '@/lib/goals/activities';

// "Mål & genomförande" för en aktivitet (CLAUDE.md § 53.4) — samma panel på
// eventsidan och i årshjulets dialog. Kopplingen + planen sparas för sig;
// "Markera genomförd" räknar utfallet server-side (event: närvaro mot plan).
// Målen i /mal läser det live — inget förs in för hand där.

const btn =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
const input =
  'w-28 rounded-lg border border-default bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export interface ActivityGoalPanelProps {
  kind: 'event' | 'annual_wheel';
  id: string;
  options: ActivityIndicatorOption[];
  /** Aktivitetens egna kopplingar. */
  selected: string[];
  /** Kopplingar som ärvs från årshjulsposten (bara event) — visas låsta. */
  inherited?: string[];
  plannedParticipants: number | null;
  /** Plan som ärvs från årshjulsposten när eventet saknar egen. */
  inheritedPlanned?: number | null;
  outcome: ActivityOutcome | null;
  completedAt?: string;
  /** Närvarande just nu (bara event) — varnar innan avslut utan markerad närvaro. */
  attended?: number;
  /** Event som genomför årshjulsposten — då avslutas den på eventet. */
  viaEvents?: { id: string; name: string }[];
  canEdit: boolean;
}

export function ActivityGoalPanel(p: ActivityGoalPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(p.selected);
  const [planned, setPlanned] = useState(p.plannedParticipants ? String(p.plannedParticipants) : '');
  const [state, setState] = useState<ActivityGoalState | null>(null);
  const [pending, start] = useTransition();
  const inherited = new Set(p.inherited ?? []);
  const known = new Set(p.options.map((o) => o.id));
  // En koppling till en indikator i ett avslutat år syns inte bland valen men
  // behålls vid sparning (tas aldrig bort tyst).
  const hiddenSelected = p.selected.filter((id) => !known.has(id));

  const run = (fn: () => Promise<ActivityGoalState>) =>
    start(async () => {
      const res = await fn();
      setState(res);
      if (res.ok) router.refresh();
    });

  const save = () =>
    run(() =>
      saveActivityGoalsAction({
        kind: p.kind,
        id: p.id,
        indicatorIds: [...selected.filter((id) => known.has(id)), ...hiddenSelected],
        plannedParticipants: planned
      })
    );

  const complete = (completion: string) => {
    if (completion === 'complete' && p.kind === 'event' && (p.attended ?? 0) === 0) {
      if (!window.confirm('Ingen närvaro är markerad. Markera eventet som genomfört ändå? (Närvaron avgör om det gick enligt plan.)')) return;
    }
    run(() => completeActivityAction({ kind: p.kind, id: p.id, completion }));
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="text-xs font-semibold text-foreground-muted">Bidrar till mål</div>
        {p.options.length === 0 ? (
          <p className="text-[12.5px] text-foreground-subtle">
            Inga mål räknas ur aktiviteter ännu. Lägg till en indikator med mätkällan &ldquo;Kopplade
            aktiviteter&rdquo; i <Link href="/mal" className="text-link hover:underline">Mål &amp; VP</Link>.
          </p>
        ) : (
          <ul className="space-y-1">
            {p.options.map((o) => {
              const viaWheel = inherited.has(o.id);
              const checked = viaWheel || selected.includes(o.id);
              return (
                <li key={o.id}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!p.canEdit || viaWheel || pending}
                      onChange={(e) =>
                        setSelected((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))
                      }
                      className="mt-1"
                      style={{ accentColor: 'var(--movexum-morkbla)' }}
                    />
                    <span>
                      <span className="font-medium text-foreground">{o.goalTitle}</span>
                      <span className="text-foreground-muted"> — {o.label}</span>
                      <span className="block text-[11px] text-foreground-subtle">
                        {isActivityMeasure(o.measure) ? ACTIVITY_MEASURE_LABELS[o.measure] : ''}
                        {o.year ? ` · ${o.year}` : ''}
                        {viaWheel ? ' · via årshjulet' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-foreground-muted">
            Planerat antal deltagare
            <input
              className={`mt-1 block ${input}`}
              inputMode="numeric"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              placeholder={p.inheritedPlanned ? String(p.inheritedPlanned) : '–'}
              disabled={!p.canEdit || pending}
            />
          </label>
          {p.canEdit && (
            <button type="button" className={btnPrimary} onClick={save} disabled={pending}>
              Spara koppling
            </button>
          )}
        </div>
        {!planned && p.inheritedPlanned ? (
          <p className="text-[11px] text-foreground-subtle">Planen ärvs från årshjulet: {p.inheritedPlanned} deltagare.</p>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-default pt-3">
        <div className="text-xs font-semibold text-foreground-muted">Genomförande</div>
        {p.outcome ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                p.outcome === 'on_plan'
                  ? 'bg-movexum-pastell-gron text-movexum-morkgron'
                  : p.outcome === 'below_plan'
                    ? 'bg-movexum-pastell-gul text-movexum-morkgul'
                    : 'bg-canvas-muted text-foreground-muted'
              }`}
            >
              {ACTIVITY_OUTCOME_LABELS[p.outcome]}
            </span>
            {p.completedAt && (
              <span className="text-[11px] text-foreground-subtle">{formatStockholmDateTime(p.completedAt)}</span>
            )}
            {p.canEdit && (
              <button type="button" className={btn} onClick={() => complete('reopen')} disabled={pending}>
                Öppna igen
              </button>
            )}
          </div>
        ) : p.viaEvents && p.viaEvents.length > 0 ? (
          <p className="text-[12.5px] text-foreground-muted">
            Genomförs via{' '}
            {p.viaEvents.map((e, i) => (
              <span key={e.id}>
                {i > 0 ? ', ' : ''}
                <Link href={`/events/${e.id}`} className="text-link hover:underline">
                  {e.name}
                </Link>
              </span>
            ))}{' '}
            — markera genomförandet där.
          </p>
        ) : p.canEdit ? (
          <div className="flex flex-wrap gap-2">
            {p.kind === 'event' ? (
              <button type="button" className={btnPrimary} onClick={() => complete('complete')} disabled={pending}>
                <Icon name="check" size={12} /> Markera genomförd
              </button>
            ) : (
              <>
                <button type="button" className={btnPrimary} onClick={() => complete('on_plan')} disabled={pending}>
                  <Icon name="check" size={12} /> Genomförd enligt plan
                </button>
                <button type="button" className={btn} onClick={() => complete('below_plan')} disabled={pending}>
                  Genomförd, under plan
                </button>
              </>
            )}
            <button type="button" className={btn} onClick={() => complete('cancelled')} disabled={pending}>
              Inställd
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] text-foreground-subtle">Inte genomförd ännu.</p>
        )}
        {p.kind === 'event' && !p.outcome && (
          <p className="text-[11px] text-foreground-subtle">
            Utfallet räknas ur närvaron mot planen: minst så många närvarande som planerat = enligt plan.
          </p>
        )}
      </div>

      {state && (
        <div
          role="status"
          className={`rounded-lg px-3 py-2 text-[12.5px] ${
            state.error
              ? 'bg-movexum-pastell-orange text-movexum-morkorange'
              : 'bg-movexum-pastell-gron text-movexum-morkgron'
          }`}
        >
          {state.error ?? state.notice}
        </div>
      )}
    </div>
  );
}
