'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/proto';
import {
  ACTIVITY_OUTCOME_LABELS,
  MISSION_ACTIVITY_KIND_LABELS,
  MISSION_MAX_ACTIVITIES,
  type MissionGoalLink
} from '@platform/shared';
import { saveMissionActivitiesAction, type MissionActivitiesState } from '@/lib/actions/mission-activities';
import type { MissionActivityOption, MissionActivityView } from '@/lib/missions/activities.server';

// "Aktiviteter & mål" på teamkortet (CLAUDE.md § 29.8): vilka årshjulsposter
// och event teamet arbetar med, och målen de bidrar till — härledda ur
// aktiviteternas kopplingar (§ 53.4), aldrig en egen kopia. Kopplingen
// sparas av en människa (ledning eller teamets ansvarige).

const btn =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
const input =
  'w-full rounded-lg border border-default bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

function outcomeChip(outcome: MissionActivityView['outcome'], date: string, today: string) {
  if (outcome === 'on_plan') return { label: ACTIVITY_OUTCOME_LABELS.on_plan, cls: 'bg-movexum-pastell-gron text-movexum-morkgron' };
  if (outcome === 'below_plan') return { label: ACTIVITY_OUTCOME_LABELS.below_plan, cls: 'bg-movexum-pastell-gul text-movexum-morkgul' };
  if (outcome === 'cancelled') return { label: ACTIVITY_OUTCOME_LABELS.cancelled, cls: 'bg-canvas-muted text-foreground-muted' };
  if (date && date < today) return { label: 'Försenad', cls: 'bg-movexum-pastell-orange text-movexum-morkorange' };
  return { label: 'Planerad', cls: 'bg-canvas-subtle text-foreground-muted' };
}

function formatDate(date: string): string {
  if (!date) return 'Utan datum';
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface MissionActivitiesPanelProps {
  missionId: string;
  activities: MissionActivityView[];
  goals: MissionGoalLink[];
  options: MissionActivityOption[];
  notice: string | null;
  /** Dagens datum (svensk tid, ISO) — räknas på servern. */
  today: string;
  canEdit: boolean;
}

export function MissionActivitiesPanel(p: MissionActivitiesPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(p.activities.map((a) => a.key));
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'annual_wheel' | 'event'>('all');
  const [state, setState] = useState<MissionActivitiesState | null>(null);
  const [pending, start] = useTransition();

  const activityById = useMemo(() => new Map(p.activities.map((a) => [a.id, a])), [p.activities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.options.filter((o) => {
      if (kindFilter !== 'all' && o.kind !== kindFilter) return false;
      if (!q) return true;
      return `${o.title} ${o.meta}`.toLowerCase().includes(q);
    });
  }, [p.options, query, kindFilter]);

  const save = () =>
    start(async () => {
      const res = await saveMissionActivitiesAction({ missionId: p.missionId, activityKeys: selected });
      setState(res);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  const cancel = () => {
    setSelected(p.activities.map((a) => a.key));
    setEditing(false);
    setState(null);
  };

  const summary = {
    total: p.activities.length,
    completed: p.activities.filter((a) => a.outcome && a.outcome !== 'cancelled').length
  };

  return (
    <Card style={{ padding: 16 }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon name="target" size={15} />
        <h2 className="mx-fw-6 mx-t-15" style={{ margin: 0 }}>
          Aktiviteter &amp; mål
        </h2>
        <span className="mx-mono mx-t-xs mx-muted">
          {summary.total === 0
            ? 'Teamet är inte kopplat till någon aktivitet'
            : `${summary.completed} av ${summary.total} genomförda · bidrar till ${p.goals.length} mål`}
        </span>
        {p.canEdit && !editing ? (
          <button type="button" className={`${btn} ml-auto`} onClick={() => setEditing(true)}>
            <Icon name="pencil" size={12} /> {summary.total === 0 ? 'Koppla aktiviteter' : 'Ändra'}
          </button>
        ) : null}
      </div>

      {p.notice ? (
        <p className="mb-3 rounded-lg bg-movexum-pastell-gul px-3 py-2 text-[12.5px] text-movexum-morkgul">{p.notice}</p>
      ) : null}

      {editing ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} max-w-xs`}
              placeholder="Sök aktivitet eller event…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex gap-1">
              {(['all', 'annual_wheel', 'event'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                    kindFilter === k ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'
                  }`}
                >
                  {k === 'all' ? 'Alla' : MISSION_ACTIVITY_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[12px] text-foreground-subtle">
              {selected.length} valda · högst {MISSION_MAX_ACTIVITIES}
            </span>
          </div>
          {p.options.length === 0 ? (
            <p className="text-[12.5px] text-foreground-subtle">
              Det finns inga aktiviteter att koppla ännu — lägg upp dem i{' '}
              <Link href="/arshjul" className="text-link hover:underline">årshjulet</Link> eller som{' '}
              <Link href="/inflode/events" className="text-link hover:underline">event</Link>.
            </p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-default p-2">
              {filtered.length === 0 ? (
                <li className="px-2 py-1 text-[12.5px] text-foreground-subtle">Inga träffar.</li>
              ) : (
                filtered.map((o) => {
                  const checked = selected.includes(o.key);
                  return (
                    <li key={o.key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-canvas-subtle">
                        <input
                          type="checkbox"
                          className="mt-1"
                          style={{ accentColor: 'var(--movexum-morkbla)' }}
                          checked={checked}
                          disabled={pending || (!checked && selected.length >= MISSION_MAX_ACTIVITIES)}
                          onChange={(e) =>
                            setSelected((cur) => (e.target.checked ? [...cur, o.key] : cur.filter((k) => k !== o.key)))
                          }
                        />
                        <span className="min-w-0">
                          <span className={`font-medium ${o.completed ? 'text-foreground-muted' : 'text-foreground'}`}>{o.title}</span>
                          <span className="block text-[11px] text-foreground-subtle">
                            {MISSION_ACTIVITY_KIND_LABELS[o.kind]} · {formatDate(o.date)}
                            {o.meta ? ` · ${o.meta}` : ''}
                            {o.completed ? ' · genomförd' : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} onClick={save} disabled={pending}>
              <Icon name="check" size={12} /> Spara koppling
            </button>
            <button type="button" className={btn} onClick={cancel} disabled={pending}>
              Avbryt
            </button>
          </div>
        </div>
      ) : p.activities.length === 0 ? (
        <p className="text-[12.5px] text-foreground-subtle">
          Koppla teamet till de aktiviteter det arbetar med — årshjulsposter och event. Målen aktiviteterna
          bidrar till (<Link href="/mal" className="text-link hover:underline">Måluppföljning</Link>) visas då här.
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          <ul className="divide-y divide-default">
            {p.activities.map((a) => {
              const chip = outcomeChip(a.outcome, a.date, p.today);
              return (
                <li key={a.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="rounded-full border border-default px-2 py-0.5 text-[11px] text-foreground-muted">
                    {MISSION_ACTIVITY_KIND_LABELS[a.kind]}
                  </span>
                  <Link href={a.href} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">
                    {a.title}
                  </Link>
                  <span className="mx-tnum text-[12px] text-foreground-subtle">{formatDate(a.date)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${chip.cls}`}>{chip.label}</span>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-default pt-3">
            <div className="mb-2 text-xs font-semibold text-foreground-muted">Bidrar till mål</div>
            {p.goals.length === 0 ? (
              <p className="text-[12.5px] text-foreground-subtle">
                Aktiviteterna är inte kopplade till något mål ännu. Kopplingen görs på aktiviteten
                (årshjulets dialog eller eventsidan, &ldquo;Mål &amp; genomförande&rdquo;).
              </p>
            ) : (
              <ul className="space-y-2">
                {p.goals.map((g) => (
                  <li key={g.goalId} className="rounded-xl border border-default px-3 py-2">
                    <Link href={`/mal?mal=${g.goalId}${g.year ? `&ar=${g.year}` : ''}`} className="font-medium text-foreground hover:underline">
                      {g.goalTitle}
                    </Link>
                    {g.year ? <span className="ml-1.5 text-[11px] text-foreground-subtle">{g.year}</span> : null}
                    <ul className="mt-1 space-y-0.5">
                      {g.indicators.map((ind) => (
                        <li key={ind.id} className="text-[12.5px] text-foreground-muted">
                          <span className="text-foreground">{ind.label}</span>
                          <span className="text-foreground-subtle">
                            {' '}
                            — via {ind.activityIds.map((id) => activityById.get(id)?.title ?? 'aktivitet').join(', ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {state ? (
        <div
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${
            state.error ? 'bg-movexum-pastell-orange text-movexum-morkorange' : 'bg-movexum-pastell-gron text-movexum-morkgron'
          }`}
        >
          {state.error ?? state.notice}
        </div>
      ) : null}
    </Card>
  );
}
