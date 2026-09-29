import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  GOAL_LEAD_ROLES,
  GOAL_STAFF_ROLES,
  INDICATOR_SOURCE_READ_ROLES,
  canCreateGoalOfKind,
  canManageGoal,
  goalKindOf,
  isAggregateOnlyIndicator,
  isGoalPeriodStatus,
  isSurveyModule,
  quarterOfDate,
  stockholmDateKey,
  validateGoalIndicatorInput,
  validateGoalInput,
  validateGoalPeriodInput,
  validateGoalStatusInput,
  yearPeriod,
  type Goal,
  type GoalIndicator,
  type GoalPeriod,
  type GoalPeriodStatus,
  type GoalStatusEntry,
  type GoalImportGoal,
  type IndicatorReading,
  type MetricKey
} from '@platform/shared';
import { computeMetric } from '@/lib/metrics/registry';
import { loadSurveyAggregate } from '@/lib/compass/survey';
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
 * Invarianter:
 *  - "En indikator, en källa": `computed` läser värdet ur metrikregistret
 *    vid statusrapportering (manuellt värde avvisas), `survey` ur enkätens
 *    k-anonyma aggregat (§ 43), `manual` skriver den mänskliga bedömningen.
 *  - **PocketBase har inget null för tal** (JSON-null blir 0). Därför bär
 *    `goal_indicators.has_target` och `goal_status_entries.has_value`
 *    (migration 1700000160) om talet är känt — läsvägen tolkar `0` utan
 *    flagga som null. Ett "kunde inte räknas" sparas alltså aldrig som 0.
 *  - Art. 9-aggregat (`aggregate_only`, § 41.2) och ANONYMA enkäter
 *    persisteras ALDRIG i statusen och når aldrig agenten — de räknas live
 *    i UI:t för behöriga (ett kvartalsvärde per anonym personalenkät vore en
 *    tidsserie som kan läsas mot personalomsättning).
 *  - Snapshotten skrivs bara av en aktör vars token läser hela källan
 *    (`INDICATOR_SOURCE_READ_ROLES`); ett okänt värde (null) skriver aldrig
 *    över ett känt.
 *  - En statusuppdatering rör bara de fält som faktiskt angetts: ett
 *    manuellt värde eller en kommentar raderas inte av ett anrop som bara
 *    byter status (SOC 2 processing integrity).
 *  - Måltyp (migration 1700000161): ÖVERGRIPANDE mål sätts/ändras/tas bort
 *    av ledningen; ett PERSONLIGT mål ägs av en medarbetare (`owner_user`)
 *    som själv får skapa, ändra och ta bort det (ledningen får alltid).
 *    Agenten kan bara skapa personliga mål åt den inloggade — aldrig åt
 *    någon annan (`owner_user` agent-nekad). `canManageGoal`/
 *    `canCreateGoalOfKind` i @platform/shared är regeln; PB-reglerna
 *    (ledning ELLER ägare) är försvaret på djupet.
 *  - Radering: verksamhetsår (cascade → mål → indikatorer → status), mål och
 *    indikatorer tas bort av ledningen (personligt mål även av ägaren).
 *    Auditeras som `update` + `deleted: true` (§ 30.6-konventionen).
 *
 * PB-target är kollektionens NAMN (§ 30.4 p. 1). Ingen PII: mål, tal,
 * teamnamn; fritext personnummer-saneras (§ 15.6) och auditeras bara som
 * längd (§ 33.2).
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

/** Tal + känt-flagga (PB kan inte lagra null för tal). */
function numberWithFlag(value: number | null, flag: string): Record<string, unknown> {
  return value === null ? { [flag]: false } : { [flag]: true };
}

// ── Verksamhetsår ────────────────────────────────────────────────────────────

export async function createGoalPeriod(
  pb: PocketBase,
  actor: Actor,
  input: { year: unknown; title?: unknown }
): Promise<WriteResult<GoalPeriod>> {
  const gate = canCreateRecord(actor, GOAL_PERIODS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const v = validateGoalPeriodInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const year = v.value.year;
  const title = v.value.title ? sanitizePersonnummer(v.value.title) : `Verksamhetsplan ${year}`;
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

/**
 * Redigera verksamhetsårets år och/eller titel. Året är unikt per tenant
 * (unikt index) — en krock rapporteras tydligt. Ett avslutat år kan också
 * redigeras (rubriken/årtalet är metadata, inte målens innehåll).
 */
export async function updateGoalPeriod(
  pb: PocketBase,
  actor: Actor,
  periodId: string,
  input: { year?: unknown; title?: unknown }
): Promise<WriteResult<GoalPeriod>> {
  const gate = canWriteField(actor, GOAL_PERIODS, 'title');
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, periodId, 'id,tenant,year,title,status');
  if (!period) return fail('NOT_FOUND', 'Verksamhetsåret hittades inte.');
  const yearChanged = input.year !== undefined && input.year !== null && input.year !== '';
  if (yearChanged) {
    const y = canWriteField(actor, GOAL_PERIODS, 'year');
    if (!y.ok) return fail('FIELD_NOT_WRITABLE', y.reason ?? 'Årtalet ändras av ledningen.');
  }
  const v = validateGoalPeriodInput({
    year: yearChanged ? input.year : period.year,
    title: input.title === undefined ? (period.title ?? '') : input.title
  });
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = {
    year: v.value.year,
    title: v.value.title ? sanitizePersonnummer(v.value.title) : `Verksamhetsplan ${v.value.year}`
  };
  if (payload.year === period.year && payload.title === (period.title ?? '')) return ok(period);
  try {
    const row = await writeWithFallback(pb, (c) => c.collection(GOAL_PERIODS).update<GoalPeriod>(periodId, payload));
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOAL_PERIODS,
      record_id: periodId,
      field: payload.year !== period.year ? 'year' : 'title',
      before_value: { year: period.year, title: period.title ?? null },
      after_value: { year: row.year, title: row.title ?? null, status: row.status }
    });
    return ok(row);
  } catch (err) {
    if ((err as { status?: number }).status === 400 && payload.year !== period.year) {
      return fail('INVALID_VALUE', `Det finns redan ett verksamhetsår för ${v.value.year}.`);
    }
    return fail('DB_ERROR', pbError(err, 'Kunde inte spara verksamhetsåret.'));
  }
}

/**
 * Tar bort ett verksamhetsår MED alla dess mål, indikatorer och kvartals-
 * statusar (PB cascade). Oåterkalleligt — UI:t kräver att årtalet skrivs in
 * som bekräftelse. Bara ledningen (`goal_periods` update-policy).
 */
export async function deleteGoalPeriod(
  pb: PocketBase,
  actor: Actor,
  periodId: string,
  opts: { confirmYear?: unknown } = {}
): Promise<WriteResult<{ id: string; year: number; goals: number }>> {
  const gate = canWriteField(actor, GOAL_PERIODS, 'status');
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, periodId, 'id,tenant,year,title,status');
  if (!period) return fail('NOT_FOUND', 'Verksamhetsåret hittades inte.');
  // Bekräftelsen prövas server-side också — klienten är aldrig gränsen.
  if (opts.confirmYear !== undefined && String(opts.confirmYear).trim() !== String(period.year)) {
    return fail('INVALID_VALUE', `Skriv ${period.year} för att bekräfta borttagningen.`);
  }
  let goalCount = 0;
  try {
    const res = await pb.collection(GOALS).getList(1, 1, {
      filter: pb.filter('tenant = {:t} && period = {:p}', { t: actor.tenant, p: period.id }),
      fields: 'id'
    });
    goalCount = res.totalItems;
  } catch {
    goalCount = 0;
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(GOAL_PERIODS).delete(periodId), { fallbackOn404: true });
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOAL_PERIODS,
      record_id: periodId,
      before_value: { year: period.year, title: period.title ?? null, goals: goalCount },
      after_value: { deleted: true, year: period.year, title: period.title ?? null, goals: goalCount }
    });
    return ok({ id: periodId, year: period.year, goals: goalCount });
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte ta bort verksamhetsåret.'));
  }
}

async function loadOpenPeriod(
  pb: PocketBase,
  actor: Actor,
  periodId: string
): Promise<GoalPeriod | { error: WriteResult<never> }> {
  const period = await getRecordInTenant<GoalPeriod>(pb, actor, GOAL_PERIODS, periodId, 'id,tenant,year,status');
  if (!period) return { error: fail('NOT_FOUND', 'Verksamhetsåret hittades inte.') };
  if (period.status === 'closed') {
    return { error: fail('STATE_TRANSITION', 'Verksamhetsåret är avslutat — det kan inte ändras.') };
  }
  return period;
}

// ── Mål ──────────────────────────────────────────────────────────────────────

/**
 * Ägaren av ett personligt mål måste vara Movexum-personal i actorns tenant
 * (defense-in-depth; klienten är aldrig säkerhetsgränsen).
 */
async function assertGoalOwnerInTenant(pb: PocketBase, actor: Actor, userId: string): Promise<WriteResult<string>> {
  if (userId === actor.id) return ok(userId);
  const row = await getRecordInTenant<{ id: string; tenant?: string; roles?: string[] }>(pb, actor, 'users', userId, 'id,tenant,roles');
  if (!row) return fail('NOT_FOUND', 'Ägaren av det personliga målet hittades inte i organisationen.');
  const roles = Array.isArray(row.roles) ? row.roles : [];
  if (!roles.some((r) => GOAL_STAFF_ROLES.includes(r))) {
    return fail('INVALID_VALUE', 'Ägaren av ett personligt mål måste vara Movexum-personal.');
  }
  return ok(row.id);
}

export async function createGoal(
  pb: PocketBase,
  actor: Actor,
  input: {
    period: string;
    focus_area: unknown;
    title: unknown;
    description?: unknown;
    owner_team?: unknown;
    /** `overall` (default) eller `personal`. */
    kind?: unknown;
    /** Bara personliga mål. Agenten får inte ange någon — målet blir den inloggades. */
    owner_user?: unknown;
  }
): Promise<WriteResult<Goal>> {
  const gate = canCreateRecord(actor, GOALS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const kindRaw = input.kind === undefined || input.kind === null || input.kind === '' ? 'overall' : input.kind;
  let ownerRaw: unknown = input.owner_user;
  if (kindRaw === 'personal') {
    if (actor.kind === 'agent') {
      if (ownerRaw && ownerRaw !== actor.id) {
        const o = canWriteField(actor, GOALS, 'owner_user');
        if (!o.ok) return fail('FIELD_NOT_WRITABLE', o.reason ?? 'Ägaren väljs av en människa.');
      }
      ownerRaw = actor.id;
    } else if (!ownerRaw) {
      ownerRaw = actor.id;
    }
  }
  const v = validateGoalInput({ ...input, kind: kindRaw, owner_user: ownerRaw });
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const allowed = canCreateGoalOfKind(v.value, actor);
  if (!allowed.ok) return fail('FORBIDDEN', allowed.error);
  if (v.value.owner_user) {
    const owner = await assertGoalOwnerInTenant(pb, actor, v.value.owner_user);
    if (!owner.ok) return owner as WriteResult<Goal>;
  }
  const period = await loadOpenPeriod(pb, actor, input.period);
  if ('error' in period) return period.error;

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
        kind: v.value.kind,
        owner_user: v.value.owner_user ?? '',
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
        kind: v.value.kind,
        // Intern användarrelation (aldrig namn/e-post i loggen).
        owner_user: v.value.owner_user ?? undefined,
        year: period.year,
        description: v.value.description ? { length: v.value.description.length } : null
      }
    });
    // Schema-drift (§ 24.4-invarianten): PB släpper okända fält tyst.
    if (v.value.kind === 'personal' && goalKindOf(row) !== 'personal') {
      return fail(
        'DB_ERROR',
        'Målet sparades, men instansen saknar fälten för personliga mål (migration 1700000161) — det blev ett övergripande mål. Kör migrationen och försök igen.'
      );
    }
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte skapa målet.'));
  }
}

export type GoalWritableField = 'title' | 'description' | 'owner_team' | 'focus_area' | 'kind' | 'owner_user';
const GOAL_FIELDS: readonly GoalWritableField[] = ['title', 'description', 'owner_team', 'focus_area', 'kind', 'owner_user'];
const GOAL_READ_FIELDS = 'id,tenant,period,focus_area,title,description,owner_team,kind,owner_user';

async function loadManageableGoal(
  pb: PocketBase,
  actor: Actor,
  goalId: string
): Promise<{ goal: Goal; period: GoalPeriod } | { error: WriteResult<never> }> {
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, goalId, GOAL_READ_FIELDS);
  if (!goal) return { error: fail('NOT_FOUND', 'Målet hittades inte.') };
  if (!canManageGoal(goal, actor)) {
    return {
      error: fail(
        'FORBIDDEN',
        goalKindOf(goal) === 'personal'
          ? 'Bara ägaren av det personliga målet eller ledningen kan ändra det.'
          : 'Övergripande mål ändras av admin/incubator_lead.'
      )
    };
  }
  const period = await loadOpenPeriod(pb, actor, goal.period);
  if ('error' in period) return period;
  return { goal, period };
}

/**
 * Uppdaterar ett eller flera fält på ett mål i EN skrivning; hela det
 * sammanslagna målet valideras (t.ex. byte till personligt kräver ägare).
 * Övergripande mål: ledningen. Personligt mål: ägaren eller ledningen. Byte av
 * måltyp/ägare kräver ledning (ett personligt mål kan inte "befordras" av
 * ägaren själv).
 */
export async function updateGoalFields(
  pb: PocketBase,
  actor: Actor,
  goalId: string,
  patch: Partial<Record<GoalWritableField, unknown>>
): Promise<WriteResult<Goal>> {
  const fields = GOAL_FIELDS.filter((f) => patch[f] !== undefined);
  if (fields.length === 0) return fail('INVALID_VALUE', 'Inget att ändra.');
  for (const field of fields) {
    const gate = canWriteField(actor, GOALS, field);
    if (!gate.ok) return fail('FIELD_NOT_WRITABLE', gate.reason ?? 'Fältet är inte skrivbart.');
  }
  const loaded = await loadManageableGoal(pb, actor, goalId);
  if ('error' in loaded) return loaded.error;
  const { goal, period } = loaded;
  const lead = actor.roles.some((r) => GOAL_LEAD_ROLES.includes(r));

  const merged: Record<string, unknown> = { ...goal, kind: goalKindOf(goal) };
  for (const field of fields) merged[field] = patch[field];
  // Byte till personligt utan angiven ägare ⇒ den som ändrar (ledningen kan peka ut någon annan).
  if (merged.kind === 'personal' && !merged.owner_user) merged.owner_user = actor.id;
  const v = validateGoalInput(merged);
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  const kindChanged = v.value.kind !== goalKindOf(goal);
  const ownerChanged = (v.value.owner_user ?? null) !== (goal.owner_user || null);
  if ((kindChanged || ownerChanged) && !lead) {
    return fail('FORBIDDEN', 'Måltyp och ägare ändras av admin/incubator_lead.');
  }
  if (v.value.kind === 'overall' && !lead) {
    return fail('FORBIDDEN', 'Övergripande mål ändras av admin/incubator_lead.');
  }
  if (ownerChanged && v.value.owner_user) {
    const owner = await assertGoalOwnerInTenant(pb, actor, v.value.owner_user);
    if (!owner.ok) return owner as WriteResult<Goal>;
  }

  const payload: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = { title: v.value.title };
  const put = (field: GoalWritableField, next: unknown, prev: unknown) => {
    if (next === prev) return;
    payload[field] = next;
    before[field] = field === 'description' ? { length: String(prev ?? '').length } : prev;
    after[field] = field === 'description' ? { length: String(next ?? '').length } : next;
  };
  put('title', sanitizePersonnummer(v.value.title), goal.title);
  put('description', v.value.description ? sanitizePersonnummer(v.value.description) : '', goal.description ?? '');
  put('owner_team', v.value.owner_team, goal.owner_team);
  put('focus_area', v.value.focus_area, goal.focus_area);
  put('kind', v.value.kind, goalKindOf(goal));
  put('owner_user', v.value.owner_user ?? '', goal.owner_user ?? '');
  if (Object.keys(payload).length === 0) return ok(goal);

  try {
    // 404-fallback: PB filtrerar bort posten (inte 403) när updateRule nekar —
    // en instans utan 1700000161 saknar "ELLER ägaren"-grenen för personliga
    // mål; roll + ägarskap är redan verifierade ovan (§ 21.3).
    const row = await writeWithFallback(pb, (c) => c.collection(GOALS).update<Goal>(goalId, payload), { fallbackOn404: true });
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOALS,
      record_id: goalId,
      field: Object.keys(payload).join(','),
      before_value: before,
      after_value: { ...after, kind: v.value.kind, year: period.year }
    });
    if (payload.kind === 'personal' && goalKindOf(row) !== 'personal') {
      return fail('DB_ERROR', 'Instansen saknar fälten för personliga mål (migration 1700000161) — måltypen sparades inte.');
    }
    return ok(row);
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte uppdatera målet.'));
  }
}

/** Ett fält i taget (chatt-verktyget) — tunt omslag över `updateGoalFields`. */
export async function updateGoalField(
  pb: PocketBase,
  actor: Actor,
  goalId: string,
  field: GoalWritableField,
  value: unknown
): Promise<WriteResult<Goal>> {
  return updateGoalFields(pb, actor, goalId, { [field]: value });
}

/** Tar bort ett mål med dess indikatorer och statusar (cascade). Ledning, eller ägaren av ett personligt mål. */
export async function deleteGoal(
  pb: PocketBase,
  actor: Actor,
  goalId: string
): Promise<WriteResult<{ id: string; title: string }>> {
  const gate = canWriteField(actor, GOALS, 'title');
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const loaded = await loadManageableGoal(pb, actor, goalId);
  if ('error' in loaded) return loaded.error;
  const { goal, period } = loaded;
  try {
    await writeWithFallback(pb, (c) => c.collection(GOALS).delete(goalId), { fallbackOn404: true });
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOALS,
      record_id: goalId,
      before_value: { title: goal.title, kind: goalKindOf(goal), focus_area: goal.focus_area },
      after_value: { deleted: true, title: goal.title, kind: goalKindOf(goal), year: period.year }
    });
    return ok({ id: goalId, title: goal.title });
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte ta bort målet.'));
  }
}

// ── Import från Excel/CSV ──────────────────────────────────────────────────

export interface ImportGoalsResult {
  created: number;
  /** Befintliga mål (samma fokusområde + titel + typ) som återanvändes. */
  reused: number;
  skipped: number;
  indicatorsCreated: number;
  /** PII-fria varningar (radnummer). */
  warnings: string[];
}

/**
 * Importerar tolkade mål (`parseGoalImportRows`, @platform/shared) till ett
 * verksamhetsår. Varje mål/indikator går genom SAMMA `createGoal`/
 * `createGoalIndicator` som UI:t och chatten — whitelist, validering,
 * behörighet per måltyp, tenant-stämpel och audit per rad. Idempotent:
 * ett mål som redan finns i året (samma fokusområde, titel och måltyp,
 * för personliga även ägare) återanvänds och får bara SAKNADE indikatorer
 * (matchade på etikett). Ägare för personliga mål matchas på e-post mot
 * Movexum-personal i tenanten; okänd e-post ⇒ importören blir ägare
 * (varning). En sammanfattningsrad loggas som `goal_import` (§ 32).
 */
export async function importGoals(
  pb: PocketBase,
  actor: Actor,
  periodId: string,
  goals: readonly GoalImportGoal[]
): Promise<WriteResult<ImportGoalsResult>> {
  const gate = canCreateRecord(actor, GOALS);
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  if (actor.kind !== 'user') return fail('FORBIDDEN', 'Import görs av en människa i /mal.');
  const period = await loadOpenPeriod(pb, actor, periodId);
  if ('error' in period) return period.error;
  const warnings: string[] = [];
  const result: ImportGoalsResult = { created: 0, reused: 0, skipped: 0, indicatorsCreated: 0, warnings };

  // Movexum-personal per e-post (bara id — e-posten lagras aldrig i loggen).
  const staffByEmail = new Map<string, string>();
  const needsOwners = goals.some((g) => g.kind === 'personal' && g.owner_email);
  if (needsOwners) {
    try {
      const res = await pb.collection('users').getList<{ id: string; email?: string; roles?: string[] }>(1, 200, {
        filter: pb.filter('tenant = {:t}', { t: actor.tenant }),
        fields: 'id,email,roles'
      });
      for (const u of res.items) {
        if (u.email && Array.isArray(u.roles) && u.roles.some((r) => GOAL_STAFF_ROLES.includes(r))) {
          staffByEmail.set(u.email.toLowerCase(), u.id);
        }
      }
    } catch {
      warnings.push('Kunde inte läsa kollegor — personliga mål utan matchad ägare får importören som ägare.');
    }
  }

  // Befintliga mål i året (dubblettkontroll).
  const existing = new Map<string, Goal>();
  try {
    const rows = await pb.collection(GOALS).getFullList<Goal>({
      filter: pb.filter('tenant = {:t} && period = {:p}', { t: actor.tenant, p: period.id }),
      fields: GOAL_READ_FIELDS,
      batch: 500
    });
    for (const g of rows) existing.set(goalDedupeKey(g), g);
  } catch {
    warnings.push('Kunde inte läsa befintliga mål — dubblettkontrollen kan vara ofullständig.');
  }

  for (const g of goals) {
    let ownerUser: string | null = null;
    if (g.kind === 'personal') {
      ownerUser = g.owner_email ? (staffByEmail.get(g.owner_email.toLowerCase()) ?? null) : null;
      if (!ownerUser) {
        if (g.owner_email) warnings.push(`Rad ${g.line}: ägarens e-post matchar ingen Movexum-kollega — du blir ägare.`);
        ownerUser = actor.id;
      }
    }
    const key = goalDedupeKey({ focus_area: g.focus_area, title: g.title, kind: g.kind, owner_user: ownerUser });
    let goal = existing.get(key) ?? null;
    if (goal) {
      result.reused++;
    } else {
      const created = await createGoal(pb, actor, {
        period: period.id,
        focus_area: g.focus_area,
        title: g.title,
        description: g.description,
        owner_team: g.owner_team,
        kind: g.kind,
        owner_user: ownerUser ?? undefined
      });
      if (!created.ok) {
        result.skipped++;
        warnings.push(`Rad ${g.line}: målet kunde inte skapas — ${created.error}`);
        continue;
      }
      goal = created.value;
      existing.set(key, goal);
      result.created++;
    }

    if (g.indicators.length === 0) continue;
    let existingLabels = new Set<string>();
    try {
      const inds = await pb.collection(GOAL_INDICATORS).getFullList<{ label: string }>({
        filter: pb.filter('tenant = {:t} && goal = {:g}', { t: actor.tenant, g: goal.id }),
        fields: 'label',
        batch: 200
      });
      existingLabels = new Set(inds.map((i) => i.label.trim().toLowerCase()));
    } catch {
      /* tom mängd — dubbletter fångas inte, men inget tappas */
    }
    for (const ind of g.indicators) {
      if (existingLabels.has(ind.label.trim().toLowerCase())) {
        warnings.push(`Rad ${ind.line}: indikatorn finns redan på målet — hoppas över.`);
        continue;
      }
      const created = await createGoalIndicator(pb, actor, {
        goal: goal.id,
        label: ind.label,
        source: ind.source,
        metric_key: ind.metric_key ?? undefined,
        target: ind.target,
        unit: ind.unit
      });
      if (!created.ok) {
        warnings.push(`Rad ${ind.line}: indikatorn kunde inte skapas — ${created.error}`);
        continue;
      }
      existingLabels.add(ind.label.trim().toLowerCase());
      result.indicatorsCreated++;
    }
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'goal_import',
    record_id: period.id,
    after_value: {
      year: period.year,
      created: result.created,
      reused: result.reused,
      skipped: result.skipped,
      indicators: result.indicatorsCreated
    }
  });
  return ok(result);
}

function goalDedupeKey(g: Pick<Goal, 'focus_area' | 'title' | 'kind' | 'owner_user'>): string {
  const kind = goalKindOf(g);
  return `${g.focus_area}|${kind}|${g.title.trim().toLowerCase()}|${kind === 'personal' ? g.owner_user || '' : ''}`;
}

// ── Indikatorer ─────────────────────────────────────────────────────────────

export async function createGoalIndicator(
  pb: PocketBase,
  actor: Actor,
  input: {
    goal: string;
    label: unknown;
    source: unknown;
    metric_key?: unknown;
    survey_module?: unknown;
    target?: unknown;
    unit?: unknown;
    direction?: unknown;
  }
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

  // Art. 9-aggregat (§ 41.2): aldrig via agenten — inte ens som indikator.
  if (actor.kind === 'agent' && isAggregateOnlyIndicator(v.value)) {
    return fail('FIELD_NOT_WRITABLE', 'Den metriken är ett känsligt aggregat och väljs av en människa i /mal.');
  }

  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, input.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const period = await loadOpenPeriod(pb, actor, goal.period);
  if ('error' in period) return period.error;

  if (v.value.source === 'survey') {
    const mod = await getRecordInTenant<{ id: string; tenant: string; purpose?: string; name?: string }>(
      pb,
      actor,
      'compass_modules',
      v.value.survey_module as string,
      'id,tenant,purpose,name'
    );
    if (!mod) return fail('NOT_FOUND', 'Enkätmodulen hittades inte i tenanten.');
    if (!isSurveyModule(mod)) return fail('INVALID_VALUE', `"${mod.name ?? 'Modulen'}" är ingen enkätmodul (syfte = enkät).`);
  }

  try {
    const row = await writeWithFallback(pb, (c) =>
      c.collection(GOAL_INDICATORS).create<GoalIndicator>({
        tenant: actor.tenant,
        goal: goal.id,
        label: sanitizePersonnummer(v.value.label),
        source: v.value.source,
        metric_key: v.value.metric_key ?? '',
        survey_module: v.value.survey_module ?? '',
        target: v.value.target ?? 0,
        ...numberWithFlag(v.value.target, 'has_target'),
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
        survey_module: v.value.survey_module,
        target: v.value.target
      }
    });
    return ok({ ...row, target: v.value.target });
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte skapa indikatorn.'));
  }
}

/**
 * Redigera etikett och/eller måltal på en indikator. Källa/metrik byts inte
 * i efterhand (då är det en ny indikator — historiken skulle annars ljuga).
 * Måltalet får bara människor sätta (agent-nekat i whitelisten).
 */
export async function updateGoalIndicator(
  pb: PocketBase,
  actor: Actor,
  indicatorId: string,
  patch: { label?: unknown; target?: unknown }
): Promise<WriteResult<GoalIndicator>> {
  const wantsLabel = patch.label !== undefined;
  const wantsTarget = patch.target !== undefined;
  if (!wantsLabel && !wantsTarget) return fail('INVALID_VALUE', 'Inget att ändra.');
  for (const field of [wantsLabel ? 'label' : null, wantsTarget ? 'target' : null]) {
    if (!field) continue;
    const gate = canWriteField(actor, GOAL_INDICATORS, field);
    if (!gate.ok) return fail('FIELD_NOT_WRITABLE', gate.reason ?? 'Fältet är inte skrivbart.');
  }
  const indicator = await getRecordInTenant<GoalIndicator & { has_target?: boolean }>(
    pb,
    actor,
    GOAL_INDICATORS,
    indicatorId,
    'id,tenant,goal,label,source,metric_key,survey_module,target,has_target,unit,direction'
  );
  if (!indicator) return fail('NOT_FOUND', 'Indikatorn hittades inte.');
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, indicator.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const period = await loadOpenPeriod(pb, actor, goal.period);
  if ('error' in period) return period.error;
  const currentTarget = indicator.has_target === false ? null : (indicator.target ?? null);
  const v = validateGoalIndicatorInput({
    label: wantsLabel ? patch.label : indicator.label,
    source: indicator.source,
    metric_key: indicator.metric_key || undefined,
    survey_module: indicator.survey_module || undefined,
    target: wantsTarget ? patch.target : currentTarget,
    unit: indicator.unit,
    direction: indicator.direction
  });
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = {};
  const label = sanitizePersonnummer(v.value.label);
  if (wantsLabel && label !== indicator.label) payload.label = label;
  if (wantsTarget && v.value.target !== currentTarget) {
    payload.target = v.value.target ?? 0;
    Object.assign(payload, numberWithFlag(v.value.target, 'has_target'));
  }
  if (Object.keys(payload).length === 0) return ok({ ...indicator, target: currentTarget });
  try {
    const row = await writeWithFallback(pb, (c) => c.collection(GOAL_INDICATORS).update<GoalIndicator>(indicatorId, payload));
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOAL_INDICATORS,
      record_id: indicatorId,
      field: Object.keys(payload).filter((k) => k !== 'has_target').join(','),
      before_value: { label: indicator.label, target: currentTarget },
      after_value: { label, target: wantsTarget ? v.value.target : currentTarget, goal_title: goal.title, goal: goal.id, year: period.year }
    });
    return ok({ ...row, target: wantsTarget ? v.value.target : currentTarget });
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte uppdatera indikatorn.'));
  }
}

/** Tar bort en indikator med dess kvartalsstatusar (cascade). Ledning. */
export async function deleteGoalIndicator(
  pb: PocketBase,
  actor: Actor,
  indicatorId: string
): Promise<WriteResult<{ id: string; label: string }>> {
  const gate = canWriteField(actor, GOAL_INDICATORS, 'label');
  if (!gate.ok) return fail('FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  const indicator = await getRecordInTenant<GoalIndicator>(pb, actor, GOAL_INDICATORS, indicatorId, 'id,tenant,goal,label,source');
  if (!indicator) return fail('NOT_FOUND', 'Indikatorn hittades inte.');
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, indicator.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const period = await loadOpenPeriod(pb, actor, goal.period);
  if ('error' in period) return period.error;
  try {
    await writeWithFallback(pb, (c) => c.collection(GOAL_INDICATORS).delete(indicatorId));
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: GOAL_INDICATORS,
      record_id: indicatorId,
      before_value: { label: indicator.label, source: indicator.source },
      after_value: { deleted: true, label: indicator.label, goal_title: goal.title, goal: goal.id, year: period.year }
    });
    return ok({ id: indicatorId, label: indicator.label });
  } catch (err) {
    return fail('DB_ERROR', pbError(err, 'Kunde inte ta bort indikatorn.'));
  }
}

// ── Kvartalsstatus ──────────────────────────────────────────────────────────

export interface RecordGoalStatusInput {
  indicator: string;
  quarter: unknown;
  status: unknown;
  /** Bara för manuella indikatorer; beräknade/enkät får värdet ur registret/aggregatet. */
  value?: unknown;
  /** `undefined`/`null` = rör inte befintlig kommentar; `''` = rensa. */
  comment?: unknown;
}

export interface RecordGoalStatusResult {
  entry: GoalStatusEntry;
  /** Avläst värde när indikatorn är beräknad/enkät (utelämnas för art. 9-aggregat). */
  reading?: IndicatorReading;
  /** true när indikatorn är ett känsligt aggregat — värdet visas bara live för behöriga. */
  aggregateOnly: boolean;
  /** true när ett värde faktiskt skrevs i den här rapporteringen. */
  valueWritten: boolean;
  /** PII-fri orsak när värdet medvetet inte skrevs (visas som notis, aldrig som fel). */
  skipReason?: string;
  created: boolean;
}

type EntryRow = GoalStatusEntry & { has_value?: boolean };

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
    'id,tenant,goal,label,source,metric_key,survey_module,target,unit,direction'
  );
  if (!indicator) return fail('NOT_FOUND', 'Indikatorn hittades inte.');
  const goal = await getRecordInTenant<Goal>(pb, actor, GOALS, indicator.goal, 'id,tenant,period,title');
  if (!goal) return fail('NOT_FOUND', 'Målet hittades inte.');
  const period = await loadOpenPeriod(pb, actor, goal.period);
  if ('error' in period) return period.error;

  const aggregateOnly = isAggregateOnlyIndicator(indicator);
  const maySnapshot = actor.roles.some((r) => INDICATOR_SOURCE_READ_ROLES.includes(r));
  let value: number | null = null;
  let valueProvided = false;
  let reading: IndicatorReading | undefined;
  let skipReason: string | undefined;

  if (indicator.source === 'computed') {
    if (v.value.value !== null) {
      return fail('INVALID_VALUE', `"${indicator.label}" beräknas ur data — värdet kan inte anges manuellt.`);
    }
    if (aggregateOnly) {
      // Art. 9-aggregat: ingen snapshot — värdet räknas live i UI:t för behöriga.
      skipReason = 'Känsligt aggregat — värdet sparas aldrig, det visas live för behöriga.';
    } else if (!maySnapshot) {
      skipReason = 'Bara admin, incubator lead och coach läser hela underlaget — värdet lämnades orört.';
    } else {
      const metric = await computeMetric(indicator.metric_key as MetricKey, {
        pb,
        tenant: actor.tenant,
        period: yearPeriod(period.year),
        today: stockholmDateKey(new Date())
      });
      reading = { source: 'computed', value: metric.value, complete: metric.complete, note: metric.note };
      value = metric.value;
      valueProvided = true;
    }
  } else if (indicator.source === 'survey') {
    if (v.value.value !== null) {
      return fail('INVALID_VALUE', `"${indicator.label}" hämtas ur enkäten — värdet kan inte anges manuellt.`);
    }
    const mod = indicator.survey_module
      ? await getRecordInTenant<{ id: string; tenant: string; slug: string; anonymous?: boolean }>(
          pb,
          actor,
          'compass_modules',
          indicator.survey_module,
          'id,tenant,slug,anonymous'
        )
      : null;
    if (!mod) {
      skipReason = 'Indikatorn saknar enkätmodul — statusen sparas utan värde.';
    } else if (mod.anonymous === true) {
      // Anonym enkät: aggregatet visas bara live (§ 43.2) — ingen kvartalsserie.
      skipReason = 'Anonym enkät — aggregatet visas live och sparas aldrig som kvartalsvärde.';
    } else if (!maySnapshot) {
      skipReason = 'Bara admin, incubator lead och coach läser hela underlaget — värdet lämnades orört.';
    } else {
      const agg = await loadSurveyAggregate(pb, actor.tenant, mod, { period: yearPeriod(period.year) });
      reading = {
        source: 'survey',
        value: agg.score,
        complete: true,
        note: agg.visible ? undefined : `Visas först vid minst ${agg.minGroup} svar (${agg.respondents} hittills).`
      };
      value = agg.score;
      valueProvided = true;
    }
  } else if (v.value.value !== null) {
    const w = canWriteField(actor, GOAL_STATUS_ENTRIES, 'value');
    if (!w.ok) return fail('FIELD_NOT_WRITABLE', w.reason ?? 'Värdet sätts av en människa.');
    value = v.value.value;
    valueProvided = true;
  }

  // Idempotent upsert på (tenant, indicator, quarter).
  let existing: EntryRow | null = null;
  try {
    const res = await pb.collection(GOAL_STATUS_ENTRIES).getList<EntryRow>(1, 1, {
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
  const existingValue: number | null = existing ? (existing.has_value === false ? null : (existing.value ?? null)) : null;

  // Ett okänt värde skriver aldrig över ett känt (SOC 2 processing integrity).
  if (valueProvided && value === null && existingValue !== null) {
    valueProvided = false;
    skipReason = `Värdet kunde inte läsas${reading?.note ? ` (${reading.note})` : ''} — det tidigare värdet behölls.`;
  }

  // Bara angivna fält skrivs: status alltid; värde när det finns/räknats;
  // kommentar när anroparen skickat en (tom sträng rensar).
  const commentProvided = input.comment !== undefined && input.comment !== null;
  const comment = commentProvided ? (v.value.comment ? sanitizePersonnummer(v.value.comment) : '') : undefined;
  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    indicator: indicator.id,
    quarter: v.value.quarter,
    status: v.value.status,
    recorded_by: actor.id
  };
  if (valueProvided) {
    payload.value = value ?? 0;
    payload.has_value = value !== null;
  } else if (!existing) {
    payload.value = 0;
    payload.has_value = false;
  }
  if (comment !== undefined) payload.comment = comment;
  else if (!existing) payload.comment = '';

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
        // Känsliga aggregat/anonyma enkäter loggas aldrig som tal (agent_actions är läsbar för chatten).
        value: valueProvided ? value : undefined,
        indicator_label: indicator.label,
        goal_title: goal.title,
        goal: goal.id,
        year: period.year,
        comment: comment ? { length: comment.length } : undefined
      }
    });
    const { has_value: _flag, ...entryFields } = entry as EntryRow;
    void _flag;
    const normalized: GoalStatusEntry = { ...entryFields, value: valueProvided ? value : existingValue };
    return ok({ entry: normalized, reading, aggregateOnly, valueWritten: valueProvided, skipReason, created: !existing });
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
