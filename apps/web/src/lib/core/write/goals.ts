import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  isGoalPeriodStatus,
  quarterOfDate,
  stockholmDateKey,
  validateGoalIndicatorInput,
  validateGoalInput,
  validateGoalStatusInput,
  yearPeriod,
  type Goal,
  type GoalIndicator,
  type GoalPeriod,
  type GoalPeriodStatus,
  type GoalStatusEntry,
  type MetricKey,
  type MetricValue
} from '@platform/shared';
import { computeMetric } from '@/lib/metrics/registry';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Målstyrning & verksamhetsplan (CLAUDE.md § 42) via det delade skrivlagret —
 * UI:s server actions OCH chatt-agenten går härigenom så att whitelist
 * (`writable-fields`), validering (`@platform/shared/goals.ts`),
 * tenant-stämpel och `agent_actions`-audit aldrig divergerar.
 *
 * Invariant "en indikator, en källa": för `source = computed` läses värdet
 * ALLTID ur metrikregistret vid statusrapportering — ett manuellt värde
 * avvisas. För `source = manual` skrivs det bedömda värdet.
 *
 * PB-target är kollektionens NAMN (§ 30.4 p. 1). Ingen PII: mål, tal,
 * teamnamn; kommentarer personnummer-saneras (§ 15.6) och auditeras bara
 * som längd (§ 33.2).
 */

export const GOAL_PERIODS = 'goal_periods';
export const GOALS = 'goals';
export const GOAL_INDICATORS = 'goal_indicators';
export const GOAL_STATUS_ENTRIES = 'goal_status_entries';

export function goalsPath(year?: number, goalId?: string): string {
  const params = new URLSearchParams();
  if (year) params.set('ar', String(year));
  if (goalId) params.set('mal', goalId);
  const qs = params.toString();
  return qs ? `/mal?${qs}` : '/mal';
}

function pbError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, { message?: string }> } })?.response?.data;
  if (data && typeof data === 'object') {
    const first = Object.entries(data)[0];
    if (first) return `${fallback} (${first[0]}: ${first[1]?.message ?? 'ogiltigt värde'})`;
  }
  return err instanceof Error && err.message ? `${fallback} (${err.message})` : fallback;
}

// ── Verksamhetsår ────────────────────────────────────────────────────────────

export async function createGoalPeriod(
  pb: PocketBase,
  actor: Actor,
  input: { year: unknown; title?: unknown }
): Promise<WriteResult<GoalPeriod>> {
  const gate = canCreateRecord(actor, GOAL_PERIODS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail('INVALID_VALUE', 'Året måste vara 2000–2100.');
  const title = String(input.title ?? '').trim().slice(0, 120) || `Verksamhetsplan ${year}`;
  try {
    const row = await writeWithFallback(pb, (c) =>
      c.collection(GOAL_PERIODS).create<GoalPeriod>({
        tenant: actor.tenant,
        year,
        title,
        status: 'draft',
        created_by: actor.id
      })
    );
    await logAgentAction(pb, {
      actor,
      action_type: 'create',
      collection: GOAL_PERIODS,
      record_id: row.id,
      after_value: { year, title }
    });
    return ok(row);
  } catch (err) {
    if ((err as { status?: number }).status === 400) {
      return fail('INVALID_VALUE', `Det finns redan ett verksamhetsår för ${year}.`);
    }
    return fail('DB_ERROR', pbError(err, 'Kunde inte skapa verksamhetsåret.'));
  }
}

export async function setGoalPeriodStatus(
  pb: PocketBase,
  actor: Actor,
  periodId: string,
  status: unknown
): Promise<WriteResult<GoalPeriod>> {
  const gate = canWriteField(actor, GOAL_PERIODS, 'status');
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  if (!isGoalPeriodStatus(status)) return fail('INVALID_VALUE', 'Ogiltig status (draft, active eller closed).');
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, periodId, 'id,tenant,year,status');
  if (!period) return fail('NOT_FOUND', 'Verksamhetsåret hittades inte.');
  try {
    const row = await writeWithFallback(pb, (c) => c.collection(GOAL_PERIODS).update<GoalPeriod>(periodId, { status }));
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOAL_PERIODS,
      record_id: periodId,
      field: 'status',
      before_value: period.status,
      after_value: { status: status as GoalPeriodStatus, year: period.year }
    });
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte ändra status.'));
  }
}

// ── Mål ──────────────────────────────────────────────────────────────────────

export async function createGoal(
  pb: PocketBase,
  actor: Actor,
  input: { period: string; focus_area: unknown; title: unknown; description?: unknown; owner_team?: unknown }
): Promise<WriteResult<Goal>> {
  const gate = canCreateRecord(actor, GOALS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const v = validateGoalInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, input.period, 'id,tenant,year,status');
  if (!period) return fail('NOT_FOUND', 'Verksamhetsåret hittades inte.');
  if (period.status === 'closed') return fail('STATE_TRANSITION', 'Verksamhetsåret är avslutat — mål kan inte läggas till.');

  let sortOrder = 0;
  try {
    const last = await pb.collection(GOALS).getList<{ sort_order?: number }>(1, 1, {
      filter: pb.filter('tenant = {:t} && period = {:p}', { t: actor.tenant, p: period.id }),
      sort: '-sort_order',
      fields: 'sort_order'
    });
    sortOrder = (last.items[0]?.sort_order ?? 0) + 10;
  } catch {
    sortOrder = 10;
  }

  try {
    const row = await writeWithFallback(pb, (c) =>
      c.collection(GOALS).create<Goal>({
        tenant: actor.tenant,
        period: period.id,
        focus_area: v.value.focus_area,
        title: sanitizePersonnummer(v.value.title),
        description: v.value.description ? sanitizePersonnummer(v.value.description) : '',
        owner_team: v.value.owner_team,
        sort_order: sortOrder,
        created_by: actor.id
      })
    );
    await logAgentAction(pb, {
      actor,
      action_type: 'create',
      collection: GOALS,
      record_id: row.id,
      after_value: {
        title: row.title,
        focus_area: v.value.focus_area,
        owner_team: v.value.owner_team,
        year: period.year,
        description: v.value.description ? { length: v.value.description.length } : null
      }
    });
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte skapa målet.'));
  }
}

export type GoalWritableField = 'title' | 'description' | 'owner_team' | 'focus_area';

export async function updateGoalField(
  pb: PocketBase,
  actor: Actor,
  goalId: string,
  field: GoalWritableField,
  value: unknown
): Promise<WriteResult<Goal>> {
  const gate = canWriteField(actor, GOALS, field);
  if (!gate.ok) return fail('FIELD_NOT_WRITABLE', gate.reason ?? 'Fältet är inte skrivbart.');
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, goalId, 'id,tenant,period,focus_area,title,description,owner_team');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const merged = { ...goal, [field]: value };
  const v = validateGoalInput(merged);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const next =
    field === 'title'
      ? sanitizePersonnummer(v.value.title)
      : field === 'description'
        ? v.value.description
          ? sanitizePersonnummer(v.value.description)
          : ''
        : v.value[field];
  try {
    const row = await writeWithFallback(pb, (c) => c.collection(GOALS).update<Goal>(goalId, { [field]: next }));
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOALS,
      record_id: goalId,
      field,
      before_value: field === 'description' ? { length: String(goal.description ?? '').length } : goal[field],
      after_value: { title: row.title, [field]: field === 'description' ? { length: String(next ?? '').length } : next }
    });
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte uppdatera målet.'));
  }
}

// ── Indikatorer ─────────────────────────────────────────────────────────────

export async function createGoalIndicator(
  pb: PocketBase,
  actor: Actor,
  input: { goal: string; label: unknown; source: unknown; metric_key?: unknown; target?: unknown; unit?: unknown; direction?: unknown }
): Promise<WriteResult<GoalIndicator>> {
  const gate = canCreateRecord(actor, GOAL_INDICATORS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  // Måltalet får bara sättas av människa (VP-beslut) — agenten föreslår i text.
  if (actor.kind === 'agent' && input.target !== undefined && input.target !== null && input.target !== '') {
    const t = canWriteField(actor, GOAL_INDICATORS, 'target');
    if (!t.ok) return fail('FIELD_NOT_WRITABLE', t.reason ?? 'Måltal sätts av en människa.');
  }
  const v = validateGoalIndicatorInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, input.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  try {
    const row = await writeWithFallback(pb, (c) =>
      c.collection(GOAL_INDICATORS).create<GoalIndicator>({
        tenant: actor.tenant,
        goal: goal.id,
        label: sanitizePersonnummer(v.value.label),
        source: v.value.source,
        metric_key: v.value.metric_key ?? '',
        target: v.value.target,
        unit: v.value.unit,
        direction: v.value.direction,
        sort_order: 0,
        created_by: actor.id
      })
    );
    await logAgentAction(pb, {
      actor,
      action_type: 'create',
      collection: GOAL_INDICATORS,
      record_id: row.id,
      after_value: {
        label: row.label,
        goal_title: goal.title,
        goal: goal.id,
        source: v.value.source,
        metric_key: v.value.metric_key,
        target: v.value.target
      }
    });
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte skapa indikatorn.'));
  }
}

// ── Kvartalsstatus ──────────────────────────────────────────────────────────

export interface RecordGoalStatusInput {
  indicator: string;
  quarter: unknown;
  status: unknown;
  /** Bara för manuella indikatorer; beräknade får värdet ur registret. */
  value?: unknown;
  comment?: unknown;
}

export interface RecordGoalStatusResult {
  entry: GoalStatusEntry;
  /** Registrets värde när indikatorn är beräknad (null om det inte kunde räknas). */
  metric?: MetricValue;
  created: boolean;
}

export async function recordGoalStatus(
  pb: PocketBase,
  actor: Actor,
  input: RecordGoalStatusInput,
  opts: { retried?: boolean } = {}
): Promise<WriteResult<RecordGoalStatusResult>> {
  const gate = canCreateRecord(actor, GOAL_STATUS_ENTRIES);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const v = validateGoalStatusInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  const indicator = await getRecordInTenant<GoalIndicator>(
    pb,
    actor,
    GOAL_INDICATORS,
    input.indicator,
    'id,tenant,goal,label,source,metric_key,target,unit,direction'
  );
  if (!indicator) return fail('NOT_FOUND', 'Indikatorn hittades inte.');
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, indicator.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, goal.period, 'id,tenant,year,status');
  if (!period) return fail('NOT_FOUND', 'Verksamhetsåret hittades inte.');
  if (period.status === 'closed') return fail('STATE_TRANSITION', 'Verksamhetsåret är avslutat.');

  let value: number | null = v.value.value;
  let metric: MetricValue | undefined;
  if (indicator.source === 'computed') {
    if (v.value.value !== null) {
      return fail('INVALID_VALUE', `"${indicator.label}" beräknas ur data — värdet kan inte anges manuellt.`);
    }
    metric = await computeMetric(indicator.metric_key as MetricKey, {
      pb,
      tenant: actor.tenant,
      period: yearPeriod(period.year),
      today: stockholmDateKey(new Date())
    });
    value = metric.value;
  } else if (v.value.value !== null) {
    const w = canWriteField(actor, GOAL_STATUS_ENTRIES, 'value');
    if (!w.ok) return fail('FIELD_NOT_WRITABLE', w.reason ?? 'Värdet sätts av en människa.');
  }

  const comment = v.value.comment ? sanitizePersonnummer(v.value.comment) : '';
  const payload = {
    tenant: actor.tenant,
    indicator: indicator.id,
    quarter: v.value.quarter,
    status: v.value.status,
    value,
    comment,
    recorded_by: actor.id
  };

  // Idempotent upsert på (tenant, indicator, quarter).
  let existing: GoalStatusEntry | null = null;
  try {
    const res = await pb.collection(GOAL_STATUS_ENTRIES).getList<GoalStatusEntry>(1, 1, {
      filter: pb.filter('tenant = {:t} && indicator = {:i} && quarter = {:q}', {
        t: actor.tenant,
        i: indicator.id,
        q: v.value.quarter
      })
    });
    existing = res.items[0] ?? null;
  } catch {
    existing = null;
  }

  try {
    const entry = existing
      ? await writeWithFallback(pb, (c) => c.collection(GOAL_STATUS_ENTRIES).update<GoalStatusEntry>(existing!.id, payload))
      : await writeWithFallback(pb, (c) => c.collection(GOAL_STATUS_ENTRIES).create<GoalStatusEntry>(payload));
    await logAgentAction(pb, {
      actor,
      action_type: existing ? 'update' : 'create',
      collection: GOAL_STATUS_ENTRIES,
      record_id: entry.id,
      field: 'status',
      before_value: existing?.status,
      after_value: {
        status: v.value.status,
        quarter: v.value.quarter,
        value,
        indicator_label: indicator.label,
        goal_title: goal.title,
        goal: goal.id,
        year: period.year,
        comment: comment ? { length: comment.length } : null
      }
    });
    return ok({ entry, metric, created: !existing });
  } catch (err) {
    if (!existing && !opts.retried && (err as { status?: number }).status === 400) {
      // Unika indexet: en parallell rapportering hann först — försök EN gång till som update.
      return recordGoalStatus(pb, actor, input, { retried: true });
    }
    return fail('DB_ERROR', pbError(err, 'Kunde inte spara statusen.'));
  }
}

/** Kvartalet "nu" i svensk kalender — default i UI och chatt. */
export function currentQuarter(): 1 | 2 | 3 | 4 {
  return quarterOfDate(stockholmDateKey(new Date()));
}
