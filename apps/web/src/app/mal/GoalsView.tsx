'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  GOAL_FOCUS_AREAS,
  GOAL_FOCUS_AREA_LABELS,
  GOAL_INDICATOR_UNITS,
  GOAL_INDICATOR_UNIT_LABELS,
  GOAL_GROUPINGS,
  GOAL_GROUPING_LABELS,
  GOAL_LEVELS,
  GOAL_LEVEL_LABELS,
  GOAL_OWNER_TEAMS,
  GOAL_OWNER_TEAM_LABELS,
  GOAL_PERIOD_STATUS_LABELS,
  ACTIVITY_MEASURES,
  ACTIVITY_MEASURE_LABELS,
  ACTIVITY_OUTCOME_LABELS,
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  QUARTERS,
  canManageGoal,
  filterGoalNodes,
  formatMetricValue,
  goalChildrenMap,
  goalKindOf,
  goalLevelOf,
  goalResponsibleId,
  goalStatusForQuarter,
  goalTeamKey,
  goalTeamLabel,
  groupGoalNodes,
  isGoalFilterActive,
  wouldCreateGoalCycle,
  isAggregateOnlyIndicator,
  progressTowardsTarget,
  rollupGoalStatuses,
  suggestStatusFromValue,
  type GoalFilter,
  type GoalGrouping,
  type GoalIndicatorNode,
  type GoalKind,
  type GoalNode,
  type GoalPeriod,
  type ActivityMeasure,
  type GoalStatus,
  type MetricKey,
  type MetricValue,
  type Quarter
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { StatusChip } from './ui';
import {
  createGoalAction,
  createGoalIndicatorAction,
  createGoalPeriodAction,
  deleteGoalAction,
  deleteGoalIndicatorAction,
  deleteGoalPeriodAction,
  recordGoalStatusAction,
  setGoalPeriodStatusAction,
  updateGoalAction,
  updateGoalIndicatorAction,
  updateGoalPeriodAction,
  type GoalActionState
} from '@/lib/actions/goals';
import type { GoalWorkspace, SurveyIndicatorValue } from '@/lib/goals/data';
import type { ActivityIndicatorLive } from '@/lib/goals/activities';

type SurveyModuleOption = GoalWorkspace['surveyModules'][number];
type PersonOption = GoalWorkspace['people'][number];

/**
 * Målträdet (CLAUDE.md § 42): fokusområde → övergripande mål / personliga mål
 * → indikator med Q1–Q4 och live-värde. Ren presentation + formulär som
 * anropar server actions; all validering och behörighet ligger i skrivlagret
 * (`canManageGoal`/`canCreateGoalOfKind` speglas här bara för att visa rätt
 * knappar). Färger följer § 2.3: grön = i fas/klar, gul = försenad, neutral =
 * ej startad — ingen röd; radering markeras i orange.
 */

const inputClass =
  'w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const btnDanger =
  'inline-flex items-center gap-1.5 rounded-full border border-movexum-morkorange/40 bg-surface px-3 py-1.5 text-sm font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:hover:bg-movexum-morkorange/20 dark:text-movexum-pastell-orange dark:focus-visible:ring-movexum-morklila';
const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const iconBtnDanger =
  'inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-movexum-pastell-orange hover:text-movexum-morkorange disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:hover:bg-movexum-morkorange/20 dark:hover:text-movexum-pastell-orange dark:focus-visible:ring-movexum-morklila';

function Notice({ state }: { state: GoalActionState | null }) {
  if (!state || (!state.error && !state.notice)) return null;
  const tone = state.error
    ? 'border-movexum-morkorange/30 bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/20 dark:text-movexum-pastell-orange'
    : 'border-movexum-morkgron/30 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron';
  return <p className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>{state.error ?? state.notice}</p>;
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-canvas-muted align-middle" aria-hidden>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function personName(people: PersonOption[], id: string | null | undefined): string | null {
  if (!id) return null;
  return people.find((p) => p.id === id)?.name ?? null;
}

/** Hierarki- och navigeringsstöd som delas av alla målkort. */
interface TreeCtx {
  goalIndex: Map<string, GoalNode>;
  children: Map<string, GoalNode[]>;
  /** Alla mål i året — val av överliggande mål. */
  allGoals: GoalNode[];
  /** Delteam som redan används (förslag i formulären). */
  subteams: string[];
  quarter: Quarter;
  highlight: string | null;
  onJump: (goalId: string) => void;
}

const EMPTY_FILTER: GoalFilter = {};

export function GoalsView({
  workspace,
  quarter,
  focusGoal,
  initialGrouping = 'focus',
  initialFilter = EMPTY_FILTER,
  currentUserId,
  canReport,
  canManage
}: {
  workspace: GoalWorkspace;
  quarter: Quarter;
  focusGoal: string | null;
  initialGrouping?: GoalGrouping;
  initialFilter?: GoalFilter;
  currentUserId: string;
  /** Movexum-personal: rapporterar status och sätter egna personliga mål. */
  canReport: boolean;
  /** Ledning (admin/incubator_lead): år, övergripande mål, indikatorer, personliga mål åt andra. */
  canManage: boolean;
}) {
  const { periods, period, tree, metrics, surveys, activities, surveyModules, people, schemaMissing } = workspace;
  const [grouping, setGrouping] = useState<GoalGrouping>(initialGrouping);
  const [filter, setFilter] = useState<GoalFilter>(initialFilter);
  const [highlight, setHighlight] = useState<string | null>(focusGoal);
  const filtered = filterGoalNodes(tree.nodes, filter, quarter);
  const filterActive = isGoalFilterActive(filter);
  const rollup = rollupGoalStatuses(filtered, quarter);
  const yearHref = (y: number, q: Quarter = quarter) => `/mal?${filterQuery({ ar: y, q }, grouping, filter)}`;
  const open = !!period && period.status !== 'closed';
  const actor = { id: currentUserId, roles: canManage ? ['admin'] : canReport ? ['coach'] : [] };

  // Filter och gruppering speglas i URL:en (delbar länk) utan serverrunda.
  useEffect(() => {
    if (!period) return;
    const qs = filterQuery({ ar: period.year, q: quarter }, grouping, filter);
    window.history.replaceState(window.history.state, '', `/mal?${qs}`);
  }, [period, quarter, grouping, filter]);

  const goalIndex = new Map(tree.nodes.map((n) => [n.goal.id, n]));
  const ctx: TreeCtx = {
    goalIndex,
    children: goalChildrenMap(tree.nodes),
    allGoals: tree.nodes,
    subteams: [...new Set(tree.nodes.map((n) => String(n.goal.subteam ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv')),
    quarter,
    highlight,
    onJump: (goalId) => {
      setHighlight(goalId);
      // Målet kan vara bortfiltrerat — släpp filtret så det syns.
      if (!filtered.some((n) => n.goal.id === goalId)) setFilter(EMPTY_FILTER);
      window.setTimeout(() => document.getElementById(`mal-${goalId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    }
  };
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? null;

  if (schemaMissing) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-movexum-morkgul/30 bg-movexum-pastell-gul p-4 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul">
        Målstyrningens kollektioner saknas på den här instansen. Kör migration 1700000159 (eller synka via
        <code className="mx-1">setup-via-api.mjs</code>) och ladda om.
      </div>
    );
  }

  const cardProps = {
    quarter,
    metrics,
    surveys,
    activities,
    surveyModules,
    people,
    focusGoal: highlight,
    actor,
    canReport: canReport && open,
    canManage: canManage && open,
    currentUserId,
    ctx
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      {/* Årsrad + kvartal */}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-default pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {periods.map((p) => (
            <Link
              key={p.id}
              href={yearHref(p.year)}
              className={`rounded-full px-3 py-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                period?.id === p.id ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'
              }`}
            >
              {p.year}
              <span className="ml-1.5 text-[11px] font-medium opacity-80">{GOAL_PERIOD_STATUS_LABELS[p.status]}</span>
            </Link>
          ))}
          {canManage && <NewPeriodForm existingYears={periods.map((p) => p.year)} />}
        </div>
        {period && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/mal/presentation?ar=${period.year}&q=${quarter}`} className={btnGhost} title="Helskärm för projektorn">
              <Icon name="external" size={12} /> Presentera
            </Link>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Kvartal</span>
            {QUARTERS.map((q) => (
              <Link
                key={q}
                href={yearHref(period.year, q)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                  q === quarter ? 'bg-foreground text-canvas' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'
                }`}
              >
                Q{q}
              </Link>
            ))}
          </div>
        )}
      </section>

      {!period ? (
        <p className="text-sm text-foreground-muted">
          Inget verksamhetsår finns ännu. {canManage ? 'Skapa ett år ovan och lägg sedan in målen per fokusområde.' : 'Ledningen skapar verksamhetsåret.'}
        </p>
      ) : (
        <>
          {/* Trafikljus — följer filtret; klick filtrerar på statusen. */}
          <section className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            {(['on_track', 'risk', 'delayed', 'not_started', 'done', 'unreported'] as const).map((st) => {
              const active = filter.status === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilter((f) => ({ ...f, status: active ? null : st }))}
                  aria-pressed={active}
                  title={active ? 'Visa alla statusar' : `Visa mål med status ${st === 'unreported' ? 'Ej rapporterad' : GOAL_STATUS_LABELS[st]} i Q${quarter}`}
                  className={`rounded-lg border-t pt-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                    active ? 'border-brand' : 'border-default hover:bg-canvas-subtle'
                  }`}
                >
                  <div className="font-heading text-2xl font-semibold tabular-nums text-foreground">{rollup[st]}</div>
                  <div className="mt-1">
                    <StatusChip status={st} small />
                  </div>
                </button>
              );
            })}
          </section>

          <GoalFilterBar
            nodes={tree.nodes}
            grouping={grouping}
            onGrouping={setGrouping}
            filter={filter}
            onFilter={setFilter}
            people={people}
            quarter={quarter}
            shown={filtered.length}
          />

          {canManage && <PeriodControls period={period} />}

          {filterActive && filtered.length === 0 && (
            <p className="text-sm text-foreground-muted">
              Inga mål matchar filtret.{' '}
              <button type="button" className="font-semibold text-link hover:underline" onClick={() => setFilter(EMPTY_FILTER)}>
                Rensa filtret
              </button>
            </p>
          )}

          {grouping === 'focus' ? (
            tree.areas.map((area) => {
              const inArea = filtered.filter((n) => n.goal.focus_area === area.area);
              const overall = inArea.filter((n) => goalKindOf(n.goal) === 'overall');
              const personal = inArea.filter((n) => goalKindOf(n.goal) === 'personal');
              // Med filter: bara områden med träffar. Utan filter visas Projektmål först när det används.
              if (filterActive ? inArea.length === 0 : area.area === 'projekt' && area.goals.length === 0) return null;
              return (
                <section key={area.area} className="space-y-5 border-t border-default pt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-heading text-lg font-semibold text-foreground">{area.label}</h2>
                    <span className="text-xs text-foreground-subtle">
                      {area.goals.length === 0 ? 'Inga mål satta' : `${overall.length} övergripande · ${personal.length} personliga`}
                    </span>
                  </div>
                  <GoalGroup kind="overall" nodes={overall} {...cardProps} canAdd={canManage && open} periodId={period.id} area={area.area} />
                  <GoalGroup kind="personal" nodes={personal} {...cardProps} canAdd={canReport && open} periodId={period.id} area={area.area} />
                </section>
              );
            })
          ) : (
            <>
              <p className="text-xs text-foreground-subtle">Nya mål läggs till i vyn Fokusområde.</p>
              {groupGoalNodes(filtered, grouping, { personName }).map((group) => (
                <section key={group.key} className="space-y-5 border-t border-default pt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-heading text-lg font-semibold text-foreground">
                      {group.label}
                      {group.sublabel && <span className="ml-2 text-sm font-normal text-foreground-subtle">{group.sublabel}</span>}
                    </h2>
                    <span className="text-xs text-foreground-subtle">
                      {group.nodes.length} mål · {groupStatusSummary(group.nodes, quarter)}
                    </span>
                  </div>
                  <div className="space-y-6">
                    {group.nodes.map((node) => (
                      <GoalCard
                        key={node.goal.id}
                        node={node}
                        quarter={quarter}
                        metrics={metrics}
                        surveys={surveys}
                        activities={activities}
                        surveyModules={surveyModules}
                        people={people}
                        ctx={ctx}
                        canReport={canReport && open}
                        focused={highlight === node.goal.id}
                        canManageIndicators={canManage && open}
                        canEdit={((canManage && open) || (canReport && open)) && canManageGoal(node.goal, actor)}
                        isLead={canManage}
                        showFocusArea={true}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Query-sträng för /mal med år, kvartal, gruppering och filter (tomma värden utelämnas). */
function filterQuery(base: { ar: number; q: Quarter }, grouping: GoalGrouping, filter: GoalFilter): string {
  const p = new URLSearchParams({ ar: String(base.ar), q: String(base.q) });
  if (grouping !== 'focus') p.set('grupp', grouping);
  if (filter.team) p.set('team', filter.team);
  if (filter.level) p.set('niva', filter.level);
  if (filter.responsible) p.set('ansvarig', filter.responsible);
  if (filter.status) p.set('status', filter.status);
  if (filter.focusArea) p.set('fokus', filter.focusArea);
  if (filter.query?.trim()) p.set('sok', filter.query.trim());
  return p.toString();
}

function groupStatusSummary(nodes: GoalNode[], quarter: Quarter): string {
  const r = rollupGoalStatuses(nodes, quarter);
  const parts = (['risk', 'delayed', 'on_track', 'done'] as const).filter((st) => r[st] > 0).map((st) => `${r[st]} ${GOAL_STATUS_LABELS[st].toLowerCase()}`);
  return parts.length ? parts.join(' · ') : `inget rapporterat Q${quarter}`;
}

// ── Filter & gruppering ─────────────────────────────────────────────────────

function GoalFilterBar({
  nodes,
  grouping,
  onGrouping,
  filter,
  onFilter,
  people,
  quarter,
  shown
}: {
  nodes: GoalNode[];
  grouping: GoalGrouping;
  onGrouping: (g: GoalGrouping) => void;
  filter: GoalFilter;
  onFilter: (f: GoalFilter | ((prev: GoalFilter) => GoalFilter)) => void;
  people: PersonOption[];
  quarter: Quarter;
  shown: number;
}) {
  // Team + delteam som faktiskt används i året.
  const teamOptions: { value: string; label: string; indent: boolean }[] = [];
  for (const t of GOAL_OWNER_TEAMS) {
    const inTeam = nodes.filter((n) => n.goal.owner_team === t);
    if (inTeam.length === 0) continue;
    teamOptions.push({ value: t, label: GOAL_OWNER_TEAM_LABELS[t], indent: false });
    const subs = new Map<string, string>();
    for (const n of inTeam) {
      const sub = String(n.goal.subteam ?? '').trim();
      if (sub) subs.set(goalTeamKey(n.goal), sub);
    }
    for (const [value, label] of [...subs].sort((a, b) => a[1].localeCompare(b[1], 'sv'))) teamOptions.push({ value, label, indent: true });
  }
  const responsibleIds = [...new Set(nodes.map((n) => goalResponsibleId(n.goal)).filter((id): id is string => !!id))];
  const responsibleOptions = responsibleIds
    .map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? 'Okänd medarbetare' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const usedLevels = GOAL_LEVELS.filter((l) => nodes.some((n) => goalLevelOf(n.goal) === l));
  const anyWithoutLevel = nodes.some((n) => goalLevelOf(n.goal) === null);
  const set = (patch: Partial<GoalFilter>) => onFilter((f) => ({ ...f, ...patch }));
  const selectClass = `${inputClass} py-1.5`;

  return (
    <section className="space-y-3 rounded-2xl border border-default bg-canvas-subtle p-3" aria-label="Filtrera och gruppera mål">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Gruppera</span>
        <div className="inline-flex flex-wrap rounded-full border border-default bg-surface p-0.5">
          {GOAL_GROUPINGS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGrouping(g)}
              aria-pressed={grouping === g}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                grouping === g ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:bg-canvas-muted'
              }`}
            >
              {GOAL_GROUPING_LABELS[g]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-foreground-subtle mx-tnum">
          Visar {shown} av {nodes.length} mål
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
        <input
          type="search"
          className={selectClass}
          placeholder="Sök mål, beskrivning eller indikator…"
          value={filter.query ?? ''}
          onChange={(e) => set({ query: e.target.value || null })}
          aria-label="Sök mål"
        />
        <select className={selectClass} value={filter.team ?? ''} onChange={(e) => set({ team: e.target.value || null })} aria-label="Team">
          <option value="">Alla team</option>
          {teamOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.indent ? `— ${o.label}` : o.label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={filter.level ?? ''}
          onChange={(e) => set({ level: (e.target.value || null) as GoalFilter['level'] })}
          aria-label="Nivå"
        >
          <option value="">Alla nivåer</option>
          {usedLevels.map((l) => (
            <option key={l} value={l}>
              {GOAL_LEVEL_LABELS[l]}
            </option>
          ))}
          {anyWithoutLevel && <option value="none">Nivå ej angiven</option>}
        </select>
        <select
          className={selectClass}
          value={filter.responsible ?? ''}
          onChange={(e) => set({ responsible: e.target.value || null })}
          aria-label="Ansvarig"
        >
          <option value="">Alla ansvariga</option>
          {responsibleOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="none">Ingen ansvarig</option>
        </select>
        <select
          className={selectClass}
          value={filter.status ?? ''}
          onChange={(e) => set({ status: (e.target.value || null) as GoalFilter['status'] })}
          aria-label={`Status Q${quarter}`}
        >
          <option value="">Alla statusar Q{quarter}</option>
          {GOAL_STATUSES.map((st) => (
            <option key={st} value={st}>
              {GOAL_STATUS_LABELS[st]}
            </option>
          ))}
          <option value="unreported">Ej rapporterad</option>
        </select>
        <button type="button" className={btnGhost} onClick={() => onFilter(EMPTY_FILTER)} disabled={!isGoalFilterActive(filter)}>
          Rensa
        </button>
      </div>
    </section>
  );
}

// ── Grupp per måltyp ────────────────────────────────────────────────────────

function GoalGroup({
  kind,
  nodes,
  quarter,
  metrics,
  surveys,
  activities,
  surveyModules,
  people,
  focusGoal,
  actor,
  canReport,
  canManage,
  canAdd,
  periodId,
  area,
  currentUserId,
  ctx
}: {
  kind: GoalKind;
  nodes: GoalNode[];
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  surveys: Record<string, SurveyIndicatorValue>;
  activities: Record<string, ActivityIndicatorLive>;
  surveyModules: SurveyModuleOption[];
  people: PersonOption[];
  focusGoal: string | null;
  actor: { id: string; roles: string[] };
  canReport: boolean;
  canManage: boolean;
  canAdd: boolean;
  periodId: string;
  area: (typeof GOAL_FOCUS_AREAS)[number];
  currentUserId: string;
  ctx: TreeCtx;
}) {
  if (nodes.length === 0 && !canAdd) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${kind === 'overall' ? 'bg-brand' : 'bg-movexum-lila'}`} aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          {kind === 'overall' ? 'Övergripande mål' : 'Personliga mål'}
        </h3>
      </div>
      {nodes.map((node) => (
        <GoalCard
          key={node.goal.id}
          node={node}
          quarter={quarter}
          metrics={metrics}
          surveys={surveys}
          activities={activities}
          surveyModules={surveyModules}
          people={people}
          ctx={ctx}
          focused={focusGoal === node.goal.id}
          canReport={canReport}
          canManageIndicators={canManage}
          canEdit={(canManage || canReport) && canManageGoal(node.goal, actor)}
          isLead={canManage}
        />
      ))}
      {canAdd && (
        <NewGoalForm periodId={periodId} area={area} kind={kind} isLead={canManage} people={people} currentUserId={currentUserId} ctx={ctx} />
      )}
    </div>
  );
}

// ── Mål ──────────────────────────────────────────────────────────────────────

function GoalCard({
  node,
  quarter,
  metrics,
  surveys,
  activities,
  surveyModules,
  people,
  focused,
  canReport,
  canManageIndicators,
  canEdit,
  isLead,
  ctx,
  showFocusArea = false
}: {
  node: GoalNode;
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  surveys: Record<string, SurveyIndicatorValue>;
  activities: Record<string, ActivityIndicatorLive>;
  surveyModules: SurveyModuleOption[];
  people: PersonOption[];
  focused: boolean;
  canReport: boolean;
  canManageIndicators: boolean;
  canEdit: boolean;
  isLead: boolean;
  ctx: TreeCtx;
  /** I gruppering efter team/nivå/ansvarig visas fokusområdet som chip. */
  showFocusArea?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  const kind = goalKindOf(node.goal);
  const owner = personName(people, node.goal.owner_user);
  const level = goalLevelOf(node.goal);
  // Ett personligt mål kan ha en ansvarig som inte är ägaren (t.ex. efter import utan e-post).
  const responsible = node.goal.responsible && node.goal.responsible !== node.goal.owner_user ? personName(people, node.goal.responsible) : null;
  const parent = node.goal.parent_goal ? ctx.goalIndex.get(node.goal.parent_goal) : undefined;
  const contributors = ctx.children.get(node.goal.id) ?? [];
  const [showContributors, setShowContributors] = useState(false);

  const remove = () => {
    if (!window.confirm(`Ta bort målet "${node.goal.title}" med alla indikatorer och kvartalsstatusar?`)) return;
    start(async () => {
      const res = await deleteGoalAction({ goalId: node.goal.id });
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div ref={ref} id={`mal-${node.goal.id}`} className={`space-y-3 ${focused ? 'rounded-xl ring-2 ring-movexum-pastell-lila dark:ring-movexum-morklila' : ''}`}>
      {editing ? (
        <GoalEditForm node={node} isLead={isLead} people={people} ctx={ctx} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 className="text-[15px] font-semibold text-foreground">{node.goal.title}</h4>
          <span
            className="rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold text-foreground-muted"
            title={node.goal.subteam ? GOAL_OWNER_TEAM_LABELS[node.goal.owner_team] : undefined}
          >
            {goalTeamLabel(node.goal)}
          </span>
          {level && level !== 'personal' && (
            <span className="rounded-full border border-default px-2 py-0.5 text-[11px] font-semibold text-foreground-muted">{GOAL_LEVEL_LABELS[level]}</span>
          )}
          {showFocusArea && (
            <span className="rounded-full border border-default px-2 py-0.5 text-[11px] text-foreground-subtle">
              {GOAL_FOCUS_AREA_LABELS[node.goal.focus_area]}
            </span>
          )}
          {responsible && (
            <span className="inline-flex items-center gap-1 text-[11px] text-foreground-muted">
              <Icon name="user" size={10} /> Ansvarig: {responsible}
            </span>
          )}
          {kind === 'personal' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-semibold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
              <Icon name="user" size={10} /> {owner ?? 'Personligt mål'}
            </span>
          )}
          {canEdit && (
            <span className="ml-auto inline-flex items-center gap-1">
              <button type="button" className={iconBtn} onClick={() => setEditing(true)} title="Redigera målet" aria-label="Redigera målet" disabled={pending}>
                <Icon name="pencil" size={13} />
              </button>
              <button type="button" className={iconBtnDanger} onClick={remove} title="Ta bort målet" aria-label="Ta bort målet" disabled={pending}>
                <Icon name="trash" size={13} />
              </button>
            </span>
          )}
          {parent && (
            <p className="w-full text-xs text-foreground-subtle">
              ↳ Bidrar till{' '}
              <button type="button" className="font-semibold text-link hover:underline" onClick={() => ctx.onJump(parent.goal.id)}>
                {parent.goal.title}
              </button>
              <span className="ml-1">({goalTeamLabel(parent.goal)})</span>
            </p>
          )}
          {node.goal.description && <p className="w-full whitespace-pre-line text-sm text-foreground-muted">{node.goal.description}</p>}
          {contributors.length > 0 && (
            <div className="w-full text-xs">
              <button
                type="button"
                className="font-semibold text-link hover:underline"
                onClick={() => setShowContributors((v) => !v)}
                aria-expanded={showContributors}
              >
                {contributors.length} {contributors.length === 1 ? 'mål bidrar' : 'mål bidrar'} hit {showContributors ? '▴' : '▾'}
              </button>
              {showContributors && (
                <ul className="mt-1 space-y-1 border-l border-default pl-3">
                  {contributors.map((c) => (
                    <li key={c.goal.id} className="flex flex-wrap items-center gap-2">
                      <StatusChip status={goalStatusForQuarter(c, ctx.quarter)} small />
                      <button type="button" className="text-left text-foreground hover:underline" onClick={() => ctx.onJump(c.goal.id)}>
                        {c.goal.title}
                      </button>
                      <span className="text-foreground-subtle">{goalTeamLabel(c.goal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {state?.error && (
            <div className="w-full">
              <Notice state={state} />
            </div>
          )}
        </div>
      )}
      {node.indicators.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                <th className="py-1.5 pr-3 font-semibold">Indikator</th>
                <th className="py-1.5 pr-3 font-semibold">Mål</th>
                <th className="py-1.5 pr-3 font-semibold">Nuläge</th>
                {QUARTERS.map((q) => (
                  <th key={q} className={`py-1.5 pr-3 font-semibold ${q === quarter ? 'text-foreground' : ''}`}>
                    Q{q}
                  </th>
                ))}
                <th className="py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {node.indicators.map((ind) => (
                <IndicatorRow
                  key={ind.indicator.id}
                  node={ind}
                  quarter={quarter}
                  metrics={metrics}
                  survey={surveys[ind.indicator.id]}
                  activity={activities[ind.indicator.id]}
                  canReport={canReport}
                  canManage={canManageIndicators}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManageIndicators && <NewIndicatorForm goalId={node.goal.id} surveyModules={surveyModules} />}
    </div>
  );
}

/** Mål som kan väljas som överliggande: alla i året utom målet självt och de som (indirekt) bidrar till det. */
function parentCandidates(ctx: TreeCtx, goalId?: string): GoalNode[] {
  if (!goalId) return ctx.allGoals;
  return ctx.allGoals.filter(
    (n) => !wouldCreateGoalCycle(goalId, n.goal.id, (id) => ctx.goalIndex.get(id)?.goal.parent_goal ?? null)
  );
}

function ParentGoalSelect({ ctx, goalId, value, onChange }: { ctx: TreeCtx; goalId?: string; value: string; onChange: (v: string) => void }) {
  const candidates = parentCandidates(ctx, goalId);
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Inget överliggande mål</option>
      {GOAL_FOCUS_AREAS.map((a) => {
        const inArea = candidates.filter((n) => n.goal.focus_area === a);
        if (inArea.length === 0) return null;
        return (
          <optgroup key={a} label={GOAL_FOCUS_AREA_LABELS[a]}>
            {inArea.map((n) => (
              <option key={n.goal.id} value={n.goal.id}>
                {n.goal.title.length > 90 ? `${n.goal.title.slice(0, 89)}…` : n.goal.title} · {goalTeamLabel(n.goal)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function SubteamInput({ ctx, value, onChange, id }: { ctx: TreeCtx; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <>
      <input
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={80}
        list={`${id}-subteams`}
        placeholder="t.ex. Sprint-X 2 – Kapital"
      />
      <datalist id={`${id}-subteams`}>
        {ctx.subteams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

function GoalEditForm({
  node,
  isLead,
  people,
  ctx,
  onDone
}: {
  node: GoalNode;
  isLead: boolean;
  people: PersonOption[];
  ctx: TreeCtx;
  onDone: () => void;
}) {
  const router = useRouter();
  const g = node.goal;
  const [title, setTitle] = useState(g.title);
  const [description, setDescription] = useState(g.description ?? '');
  const [team, setTeam] = useState<string>(g.owner_team);
  const [subteam, setSubteam] = useState<string>(g.subteam ?? '');
  const [area, setArea] = useState<string>(g.focus_area);
  const [level, setLevel] = useState<string>(goalLevelOf(g) ?? '');
  const [owner, setOwner] = useState<string>(g.owner_user ?? '');
  const [responsible, setResponsible] = useState<string>(g.responsible ?? '');
  const [parent, setParent] = useState<string>(g.parent_goal ?? '');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const personal = level === 'personal';
  return (
    <form
      className="grid gap-3 rounded-xl border border-default p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const patch: Record<string, string> = { title, description, owner_team: team, focus_area: area, subteam, parent_goal: parent };
          if (isLead) {
            // Nivån styr måltypen (Personligt mål ⇔ personligt) — skrivlagret validerar.
            patch.level = level;
            patch.kind = personal ? 'personal' : 'overall';
            patch.owner_user = personal ? owner : '';
            // Ett personligt mål behåller sin ansvariga (sätts vid import); övergripande styrs av valet.
            if (!personal) patch.responsible = responsible;
          }
          const res = await updateGoalAction({ goalId: g.id, patch });
          setState(res);
          if (res.ok) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div className="sm:col-span-3">
        <label className={labelClass}>Mål</label>
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </div>
      <div>
        <label className={labelClass}>Fokusområde</label>
        <select className={inputClass} value={area} onChange={(e) => setArea(e.target.value)}>
          {GOAL_FOCUS_AREAS.map((a) => (
            <option key={a} value={a}>
              {GOAL_FOCUS_AREA_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Ägande team</label>
        <select className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)}>
          {GOAL_OWNER_TEAMS.map((t) => (
            <option key={t} value={t}>
              {GOAL_OWNER_TEAM_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Delteam / projekt (valfritt)</label>
        <SubteamInput ctx={ctx} value={subteam} onChange={setSubteam} id={`edit-${g.id}`} />
      </div>
      {isLead && (
        <>
          <div>
            <label className={labelClass}>Nivå</label>
            <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Ej angiven</option>
              {GOAL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {GOAL_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{personal ? 'Ägare (medarbetare)' : 'Ansvarig'}</label>
            {personal ? (
              <select className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} required>
                <option value="">Välj…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <select className={inputClass} value={responsible} onChange={(e) => setResponsible(e.target.value)}>
                <option value="">Ingen ansvarig</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}
      <div className={isLead ? '' : 'sm:col-span-3'}>
        <label className={labelClass}>Bidrar till (överliggande mål)</label>
        <ParentGoalSelect ctx={ctx} goalId={g.id} value={parent} onChange={setParent} />
      </div>
      <div className="sm:col-span-3">
        <label className={labelClass}>Beskrivning (valfri, inga personuppgifter)</label>
        <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Spara
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-3">
        <Notice state={state} />
      </div>
    </form>
  );
}

function IndicatorRow({
  node,
  quarter,
  metrics,
  survey,
  activity,
  canReport,
  canManage
}: {
  node: GoalIndicatorNode;
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  survey?: SurveyIndicatorValue;
  /** Live-resultat för en aktivitetsindikator (§ 53.4). */
  activity?: ActivityIndicatorLive;
  canReport: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const { indicator } = node;
  const live = indicator.source === 'computed' && indicator.metric_key ? metrics[indicator.metric_key as MetricKey] : undefined;
  const aggregateOnly = isAggregateOnlyIndicator(indicator);
  const latestManual = node.latest?.value ?? null;
  const current =
    indicator.source === 'computed'
      ? (live?.value ?? null)
      : indicator.source === 'survey'
        ? (survey?.value ?? null)
        : indicator.source === 'activities'
          ? (activity?.value ?? null)
          : latestManual;
  const liveNote =
    indicator.source === 'activities'
      ? (activity?.note ?? 'Inga aktiviteter är kopplade till indikatorn ännu.')
      : indicator.source === 'survey'
      ? survey
        ? survey.visible
          ? `${survey.respondents} svar`
          : `Visas först vid minst ${survey.minGroup} svar (${survey.respondents} hittills).`
        : 'Enkätmodulen saknas.'
      : aggregateOnly && !live
        ? 'Känsligt aggregat — visas bara för admin/incubator_lead/coach.'
        : live?.note;
  const unit = { unit: indicator.unit === 'bool' ? 'count' : indicator.unit } as const;
  // Aktivitetsindikatorer jämför utfallet med planen hittills (§ 53.4); övriga mot måltalet.
  const suggestion = indicator.source === 'activities' ? (activity?.status ?? null) : suggestStatusFromValue(indicator, current);
  const [open, setOpen] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    if (!window.confirm(`Ta bort indikatorn "${indicator.label}" med alla kvartalsstatusar?`)) return;
    start(async () => {
      const res = await deleteGoalIndicatorAction({ indicatorId: indicator.id });
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <>
      <tr className="border-t border-default align-top">
        <td className="py-2 pr-3">
          <div className="font-medium text-foreground">{indicator.label}</div>
          <div className="text-[11px] text-foreground-subtle">
            {indicator.source === 'computed' && indicator.metric_key
              ? `Beräknas: ${METRIC_DEFINITIONS[indicator.metric_key as MetricKey]?.label ?? indicator.metric_key}`
              : indicator.source === 'survey'
                ? 'Enkät i Startupkompassen (medel 1–10)'
                : indicator.source === 'activities'
                  ? `Aktiviteter: ${ACTIVITY_MEASURE_LABELS[indicator.activity_measure as ActivityMeasure] ?? 'okänt mått'}`
                  : 'Manuell bedömning'}
          </div>
          {indicator.source === 'activities' && activity && activity.activities.length > 0 && (
            <button
              type="button"
              className="mt-0.5 text-[11px] font-semibold text-link hover:underline"
              onClick={() => setShowActivities((v) => !v)}
            >
              {showActivities ? 'Dölj' : 'Visa'} {activity.activities.length} kopplade aktiviteter
            </button>
          )}
          {showActivities && activity && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-foreground-muted">
              {activity.activities.map((a) => (
                <li key={`${a.kind}:${a.id}`}>
                  <Link
                    href={a.kind === 'event' ? `/events/${a.id}` : `/arshjul?item=${encodeURIComponent(a.id)}`}
                    className="hover:underline"
                  >
                    {a.date ? `${a.date} · ` : ''}
                    {a.title}
                  </Link>{' '}
                  · {a.outcome ? ACTIVITY_OUTCOME_LABELS[a.outcome] : 'Ej genomförd'}
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="py-2 pr-3 tabular-nums text-foreground">
          {indicator.unit === 'bool' ? 'Ja' : indicator.target === null || indicator.target === undefined ? (indicator.target_text ? '' : '–') : formatMetricValue(unit, indicator.target)}
          {indicator.target_text && <div className="max-w-[16rem] text-[11px] font-normal text-foreground-subtle">{indicator.target_text}</div>}
        </td>
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2 tabular-nums text-foreground">
            {indicator.unit === 'bool' && indicator.source === 'manual' ? (
              <span className="text-foreground-muted">{node.latest ? GOAL_STATUS_LABELS[node.latest.status] : '–'}</span>
            ) : (
              <>
                <span>{live && !live.complete && live.value !== null ? '≥ ' : ''}{formatMetricValue(unit, current)}</span>
                <Meter value={progressTowardsTarget(indicator, current)} />
              </>
            )}
          </div>
          {liveNote && <div className="text-[11px] text-foreground-subtle">{liveNote}</div>}
          {suggestion && indicator.unit !== 'bool' && (
            <div className="text-[11px] text-foreground-subtle">Förslag: {GOAL_STATUS_LABELS[suggestion]}</div>
          )}
        </td>
        {QUARTERS.map((q) => {
          const e = node.byQuarter[q];
          return (
            <td key={q} className="py-2 pr-3">
              {e ? (
                <span title={e.comment ?? undefined}>
                  <StatusChip status={e.status} small />
                </span>
              ) : (
                <span className="text-foreground-subtle">–</span>
              )}
            </td>
          );
        })}
        <td className="py-2 text-right">
          <span className="inline-flex items-center gap-1">
            {canReport && (
              <button type="button" className={btnGhost} onClick={() => setOpen((v) => !v)}>
                <Icon name="pencil" size={12} /> Q{quarter}
              </button>
            )}
            {canManage && (
              <>
                <button type="button" className={iconBtn} onClick={() => setEditing((v) => !v)} title="Redigera indikatorn" aria-label="Redigera indikatorn" disabled={pending}>
                  <Icon name="gear" size={13} />
                </button>
                <button type="button" className={iconBtnDanger} onClick={remove} title="Ta bort indikatorn" aria-label="Ta bort indikatorn" disabled={pending}>
                  <Icon name="trash" size={13} />
                </button>
              </>
            )}
          </span>
        </td>
      </tr>
      {state?.error && (
        <tr>
          <td colSpan={8} className="pb-2">
            <Notice state={state} />
          </td>
        </tr>
      )}
      {editing && (
        <tr className="border-t border-default bg-canvas-subtle">
          <td colSpan={8} className="p-3">
            <IndicatorEditForm node={node} onDone={() => setEditing(false)} />
          </td>
        </tr>
      )}
      {open && (
        <tr className="border-t border-default bg-canvas-subtle">
          <td colSpan={8} className="p-3">
            <StatusForm
              node={node}
              quarter={quarter}
              suggestion={suggestion}
              onDone={() => setOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function IndicatorEditForm({ node, onDone }: { node: GoalIndicatorNode; onDone: () => void }) {
  const router = useRouter();
  const { indicator } = node;
  const [label, setLabel] = useState(indicator.label);
  const [target, setTarget] = useState(indicator.target === null || indicator.target === undefined ? '' : String(indicator.target));
  const [targetText, setTargetText] = useState(indicator.target_text ?? '');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_140px_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateGoalIndicatorAction({ indicatorId: indicator.id, label, target, target_text: targetText });
          setState(res);
          if (res.ok) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Indikator</label>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} required />
      </div>
      <div>
        <label className={labelClass}>Måltal</label>
        <input className={inputClass} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="–" />
      </div>
      <div>
        <label className={labelClass}>Målvärde i text (valfritt)</label>
        <input className={inputClass} value={targetText} onChange={(e) => setTargetText(e.target.value)} maxLength={200} placeholder="t.ex. Över 40 %" />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Spara
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Avbryt
        </button>
      </div>
      <p className="text-[11px] text-foreground-subtle sm:col-span-4">
        Mätkälla och metrik byts inte i efterhand — ta bort indikatorn och skapa en ny om källan ska ändras.
      </p>
      <div className="sm:col-span-4">
        <Notice state={state} />
      </div>
    </form>
  );
}

function StatusForm({
  node,
  quarter,
  suggestion,
  onDone
}: {
  node: GoalIndicatorNode;
  quarter: Quarter;
  suggestion: GoalStatus | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const existing = node.byQuarter[quarter];
  const [status, setStatus] = useState<GoalStatus>(existing?.status ?? suggestion ?? 'on_track');
  const [value, setValue] = useState(existing?.value !== null && existing?.value !== undefined ? String(existing.value) : '');
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const manual = node.indicator.source === 'manual';
  const sourceLabel =
    node.indicator.source === 'survey'
      ? 'Värde (ur enkäten)'
      : node.indicator.source === 'activities'
        ? 'Värde (ur aktiviteterna)'
        : 'Värde (ur data)';

  return (
    <form
      className="grid gap-3 sm:grid-cols-[160px_140px_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await recordGoalStatusAction({
            indicator: node.indicator.id,
            quarter,
            status,
            value: manual ? value : undefined,
            comment
          });
          setState(res);
          if (res.ok) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Status Q{quarter}</label>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
          {GOAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {GOAL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>{manual ? 'Värde' : sourceLabel}</label>
        {manual ? (
          <input className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="t.ex. 4,2" />
        ) : (
          <p className="py-2 text-xs text-foreground-subtle">Hämtas automatiskt när du sparar.</p>
        )}
      </div>
      <div>
        <label className={labelClass}>Kommentar (inga personuppgifter)</label>
        <input className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Spara
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-4">
        <Notice state={state} />
      </div>
    </form>
  );
}

// ── Verksamhetsår (ledningen) ───────────────────────────────────────────────

function NewPeriodForm({ existingYears }: { existingYears: number[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const nextYear = Math.max(new Date().getFullYear(), ...existingYears, 0) + (existingYears.length ? 1 : 0);
  const [year, setYear] = useState(String(nextYear));
  const [title, setTitle] = useState('');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> Verksamhetsår
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalPeriodAction({ year: Number(year), title: title || undefined });
          setState(res);
          if (res.ok) {
            router.push(`/mal?ar=${year}`);
            setOpen(false);
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>År</label>
        <input className={`${inputClass} w-24`} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>Titel (valfri)</label>
        <input className={`${inputClass} w-56`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={`Verksamhetsplan ${year}`} />
      </div>
      <button type="submit" className={btnPrimary} disabled={pending}>
        Skapa
      </button>
      <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
        Avbryt
      </button>
      <Notice state={state} />
    </form>
  );
}

/**
 * Status (utkast → aktiv → avslutad, samt återöppna), redigera år/titel och
 * ta bort året. Radering kräver att årtalet skrivs in — den tar bort ALLA
 * mål, indikatorer och kvartalsstatusar (PB cascade).
 */
function PeriodControls({ period }: { period: GoalPeriod }) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'edit' | 'delete'>('idle');
  const [year, setYear] = useState(String(period.year));
  const [title, setTitle] = useState(period.title ?? '');
  const [confirmYear, setConfirmYear] = useState('');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();

  const setStatus = (next: string) =>
    start(async () => {
      const res = await setGoalPeriodStatusAction({ periodId: period.id, status: next });
      setState(res);
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-3 rounded-xl border border-default bg-canvas-subtle/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
        <span className="font-medium text-foreground">{period.title || `Verksamhetsplan ${period.year}`}</span>
        <span className="rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold">{GOAL_PERIOD_STATUS_LABELS[period.status]}</span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          {period.status === 'draft' && (
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => setStatus('active')}>
              Aktivera (VP beslutad)
            </button>
          )}
          {period.status === 'active' && (
            <button type="button" className={btnGhost} disabled={pending} onClick={() => setStatus('closed')}>
              Avsluta verksamhetsåret
            </button>
          )}
          {period.status === 'closed' && (
            <button type="button" className={btnGhost} disabled={pending} onClick={() => setStatus('active')} title="Öppna året igen så mål och status kan ändras">
              Återöppna
            </button>
          )}
          {period.status !== 'closed' && (
            <Link href={`/mal/import?ar=${period.year}`} className={btnGhost} title="Ladda upp mål från Excel eller CSV">
              <Icon name="upload" size={12} /> Importera från Excel
            </Link>
          )}
          <button type="button" className={btnGhost} disabled={pending} onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>
            <Icon name="pencil" size={12} /> Redigera år
          </button>
          <button type="button" className={btnDanger} disabled={pending} onClick={() => setMode(mode === 'delete' ? 'idle' : 'delete')}>
            <Icon name="trash" size={12} /> Ta bort år
          </button>
        </span>
      </div>
      {period.status === 'closed' && mode === 'idle' && (
        <p className="text-xs text-foreground-subtle">Året är avslutat — återöppna det för att ändra mål eller rapportera status.</p>
      )}

      {mode === 'edit' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateGoalPeriodAction({ periodId: period.id, year, title });
              setState(res);
              if (res.ok) {
                setMode('idle');
                if (Number(year) !== period.year) router.push(`/mal?ar=${year}`);
                else router.refresh();
              }
            });
          }}
        >
          <div>
            <label className={labelClass}>År</label>
            <input className={`${inputClass} w-24`} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className={labelClass}>Titel</label>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={`Verksamhetsplan ${year}`} />
          </div>
          <button type="submit" className={btnPrimary} disabled={pending}>
            Spara
          </button>
          <button type="button" className={btnGhost} onClick={() => setMode('idle')}>
            Avbryt
          </button>
        </form>
      )}

      {mode === 'delete' && (
        <form
          className="space-y-2 rounded-lg border border-movexum-morkorange/30 bg-movexum-pastell-orange/60 p-3 dark:bg-movexum-morkorange/15"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmYear.trim() !== String(period.year)) {
              setState({ error: `Skriv ${period.year} för att bekräfta.` });
              return;
            }
            start(async () => {
              const res = await deleteGoalPeriodAction({ periodId: period.id, confirmYear });
              setState(res);
              if (res.ok) router.push('/mal');
            });
          }}
        >
          <p className="text-sm text-movexum-morkorange dark:text-movexum-pastell-orange">
            Tar bort verksamhetsåret {period.year} <strong>med alla mål, indikatorer och kvartalsstatusar</strong>. Det går inte att ångra.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelClass}>Skriv {period.year} för att bekräfta</label>
              <input className={`${inputClass} w-32`} inputMode="numeric" value={confirmYear} onChange={(e) => setConfirmYear(e.target.value)} autoFocus />
            </div>
            <button type="submit" className={btnDanger} disabled={pending || confirmYear.trim() !== String(period.year)}>
              <Icon name="trash" size={12} /> Ta bort året
            </button>
            <button type="button" className={btnGhost} onClick={() => setMode('idle')}>
              Avbryt
            </button>
          </div>
        </form>
      )}
      <Notice state={state} />
    </div>
  );
}

// ── Nytt mål ────────────────────────────────────────────────────────────────

function NewGoalForm({
  periodId,
  area,
  kind,
  isLead,
  people,
  currentUserId,
  ctx
}: {
  periodId: string;
  area: (typeof GOAL_FOCUS_AREAS)[number];
  kind: GoalKind;
  isLead: boolean;
  people: PersonOption[];
  currentUserId: string;
  ctx: TreeCtx;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [team, setTeam] = useState<string>('gemensamt');
  const [owner, setOwner] = useState<string>(currentUserId);
  const [level, setLevel] = useState<string>(kind === 'personal' ? 'personal' : 'team');
  const [subteam, setSubteam] = useState('');
  const [responsible, setResponsible] = useState('');
  const [parent, setParent] = useState('');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} />{' '}
        {kind === 'overall' ? `Nytt övergripande mål i ${GOAL_FOCUS_AREA_LABELS[area].toLowerCase()}` : 'Nytt personligt mål'}
      </button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-xl border border-default p-3 sm:grid-cols-[1fr_180px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalAction({
            period: periodId,
            focus_area: area,
            title,
            description,
            owner_team: team,
            kind,
            owner_user: kind === 'personal' ? (isLead ? owner : currentUserId) : undefined,
            level: kind === 'personal' ? 'personal' : level,
            subteam,
            parent_goal: parent,
            responsible: kind === 'overall' ? responsible : undefined
          });
          setState(res);
          if (res.ok) {
            setTitle('');
            setDescription('');
            setSubteam('');
            setParent('');
            setResponsible('');
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>{kind === 'overall' ? 'Övergripande mål' : 'Personligt mål'}</label>
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          placeholder={kind === 'overall' ? 't.ex. Konvertering 50 % från ink till acc inom 8 månader' : 't.ex. Genomföra 12 coachsamtal per kvartal'}
        />
      </div>
      <div>
        <label className={labelClass}>Ägande team</label>
        <select className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)}>
          {GOAL_OWNER_TEAMS.map((t) => (
            <option key={t} value={t}>
              {GOAL_OWNER_TEAM_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Lägg till
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      {kind === 'personal' && (
        <div className="sm:col-span-3">
          <label className={labelClass}>Vems mål</label>
          {isLead ? (
            <select className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === currentUserId ? `${p.name} (jag)` : p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="py-1 text-sm text-foreground-muted">Ditt eget mål — ledningen kan sätta personliga mål åt andra.</p>
          )}
        </div>
      )}
      {kind === 'overall' && (
        <div className="grid gap-3 sm:col-span-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Nivå</label>
            <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Ej angiven</option>
              {GOAL_LEVELS.filter((l) => l !== 'personal').map((l) => (
                <option key={l} value={l}>
                  {GOAL_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Ansvarig</label>
            <select className={inputClass} value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              <option value="">Ingen ansvarig</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Delteam / projekt (valfritt)</label>
            <SubteamInput ctx={ctx} value={subteam} onChange={setSubteam} id={`new-${area}-${kind}`} />
          </div>
        </div>
      )}
      {kind === 'personal' && (
        <div className="sm:col-span-3">
          <label className={labelClass}>Delteam / projekt (valfritt)</label>
          <SubteamInput ctx={ctx} value={subteam} onChange={setSubteam} id={`new-${area}-${kind}`} />
        </div>
      )}
      <div className="sm:col-span-3">
        <label className={labelClass}>Bidrar till (överliggande mål, valfritt)</label>
        <ParentGoalSelect ctx={ctx} value={parent} onChange={setParent} />
      </div>
      <div className="sm:col-span-3">
        <label className={labelClass}>Beskrivning (valfri, inga personuppgifter)</label>
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div className="sm:col-span-3">
        <Notice state={state} />
      </div>
    </form>
  );
}

function NewIndicatorForm({ goalId, surveyModules }: { goalId: string; surveyModules: SurveyModuleOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<'computed' | 'manual' | 'survey' | 'activities'>('computed');
  const [measure, setMeasure] = useState<ActivityMeasure>('completed');
  const [surveyModule, setSurveyModule] = useState<string>(surveyModules[0]?.id ?? '');
  const [metricKey, setMetricKey] = useState<string>(METRIC_KEYS.find((k) => METRIC_DEFINITIONS[k].scope === 'tenant') ?? 'active_startups');
  const [target, setTarget] = useState('');
  const [targetText, setTargetText] = useState('');
  const [unit, setUnit] = useState<string>('bool');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const tenantMetrics = METRIC_KEYS.filter((k) => METRIC_DEFINITIONS[k].scope === 'tenant');

  if (!open) {
    return (
      <button type="button" className="rounded text-xs font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila" onClick={() => setOpen(true)}>
        + Indikator
      </button>
    );
  }
  const def = METRIC_DEFINITIONS[metricKey as MetricKey];
  return (
    <form
      className="grid gap-3 rounded-xl border border-dashed border-default p-3 sm:grid-cols-[1fr_170px_1fr_120px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalIndicatorAction({
            goal: goalId,
            label,
            source,
            metric_key: source === 'computed' ? metricKey : undefined,
            survey_module: source === 'survey' ? surveyModule : undefined,
            activity_measure: source === 'activities' ? measure : undefined,
            target,
            target_text: targetText,
            unit: source === 'manual' ? unit : undefined
          });
          setState(res);
          if (res.ok) {
            setLabel('');
            setTarget('');
            setTargetText('');
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Indikator</label>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} required placeholder="t.ex. Antal alumnibolag" />
      </div>
      <div>
        <label className={labelClass}>Mätkälla</label>
        <select
          className={inputClass}
          value={source}
          onChange={(e) => setSource(e.target.value as 'computed' | 'manual' | 'survey' | 'activities')}
        >
          <option value="computed">Beräknas ur data</option>
          <option value="activities">Kopplade aktiviteter</option>
          <option value="survey" disabled={surveyModules.length === 0}>
            Enkät i Startupkompassen{surveyModules.length === 0 ? ' (ingen enkätmodul ännu)' : ''}
          </option>
          <option value="manual">Manuell bedömning</option>
        </select>
      </div>
      <div>
        {source === 'computed' ? (
          <>
            <label className={labelClass}>Metrik</label>
            <select className={inputClass} value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              {tenantMetrics.map((k) => (
                <option key={k} value={k}>
                  {METRIC_DEFINITIONS[k].label}
                </option>
              ))}
            </select>
            {def && <p className="mt-1 text-[11px] text-foreground-subtle">{def.description}</p>}
          </>
        ) : source === 'activities' ? (
          <>
            <label className={labelClass}>Mäter</label>
            <select className={inputClass} value={measure} onChange={(e) => setMeasure(e.target.value as ActivityMeasure)}>
              {ACTIVITY_MEASURES.map((m) => (
                <option key={m} value={m}>
                  {ACTIVITY_MEASURE_LABELS[m]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-foreground-subtle">
              Koppla aktiviteter i årshjulet eller på eventet — värdet och statusen räknas live mot planen.
            </p>
          </>
        ) : source === 'survey' ? (
          <>
            <label className={labelClass}>Enkätmodul</label>
            <select className={inputClass} value={surveyModule} onChange={(e) => setSurveyModule(e.target.value)}>
              {surveyModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-foreground-subtle">Medel av skalfrågorna (1–10), k-anonymt. Skapa enkäter i Startupkompassen.</p>
          </>
        ) : (
          <>
            <label className={labelClass}>Enhet</label>
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {GOAL_INDICATOR_UNITS.map((u) => (
                <option key={u} value={u}>
                  {GOAL_INDICATOR_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div>
        <label className={labelClass}>Måltal</label>
        <input className={inputClass} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={source === 'computed' && def ? (def.unit === 'pct' ? '%' : 'antal') : ''} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Lägg till
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-5">
        <label className={labelClass}>Målvärde i text (valfritt — när målet inte ryms i ett tal)</label>
        <input className={inputClass} value={targetText} onChange={(e) => setTargetText(e.target.value)} maxLength={200} placeholder="t.ex. Ökning med 12 st i BC och 5 st ink/acc" />
      </div>
      <div className="sm:col-span-5">
        <Notice state={state} />
      </div>
    </form>
  );
}
