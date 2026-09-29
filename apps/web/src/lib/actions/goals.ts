'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createGoal,
  createGoalIndicator,
  createGoalPeriod,
  deleteGoal,
  deleteGoalIndicator,
  deleteGoalPeriod,
  importGoals,
  recordGoalStatus,
  setGoalPeriodStatus,
  updateGoalFields,
  updateGoalIndicator,
  updateGoalPeriod,
  type Actor,
  type GoalWritableField,
  type ImportGoalsResult
} from '@/lib/core/write';
import { readTableFile } from '@/lib/import/table-file';
import { GOAL_IMPORT_MAX_ROWS, parseGoalImportRows, type GoalImportField, type GoalImportGoal, type Role } from '@platform/shared';

/**
 * Server actions för målstyrningen (CLAUDE.md § 42). Tunna skal: RBAC här,
 * validering + whitelist + audit i det delade skrivlagret. Klienten är
 * aldrig säkerhetsgränsen.
 */

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface GoalActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  id?: string;
}

function actorOf(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

function revalidate() {
  revalidatePath('/mal');
  revalidatePath('/hem');
  revalidatePath('/aktivitet');
}

async function gate(roles: Role[], message: string): Promise<{ actor: Actor } | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, roles)) return { error: message };
  return { actor: actorOf(user) };
}

export async function createGoalPeriodAction(input: { year: number; title?: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan skapa ett verksamhetsår.');
  if ('error' in g) return { error: g.error };
  const res = await createGoalPeriod(await getServerPb(), g.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: `Verksamhetsår ${res.value.year} skapat.` };
}

export async function updateGoalPeriodAction(input: { periodId: string; year?: string; title?: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan redigera ett verksamhetsår.');
  if ('error' in g) return { error: g.error };
  const res = await updateGoalPeriod(await getServerPb(), g.actor, input.periodId, { year: input.year, title: input.title });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: 'Verksamhetsåret är uppdaterat.' };
}

/** Oåterkalleligt: tar bort året MED alla mål, indikatorer och statusar. Klienten kräver att årtalet skrivs in. */
export async function deleteGoalPeriodAction(input: { periodId: string; confirmYear: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan ta bort ett verksamhetsår.');
  if ('error' in g) return { error: g.error };
  const pb = await getServerPb();
  const res = await deleteGoalPeriod(pb, g.actor, input.periodId, { confirmYear: input.confirmYear });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: `Verksamhetsår ${res.value.year} och ${res.value.goals} mål är borttagna.` };
}

export async function setGoalPeriodStatusAction(input: { periodId: string; status: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan ändra verksamhetsårets status.');
  if ('error' in g) return { error: g.error };
  const res = await setGoalPeriodStatus(await getServerPb(), g.actor, input.periodId, input.status);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id };
}

export async function createGoalAction(input: {
  period: string;
  focus_area: string;
  title: string;
  description?: string;
  owner_team?: string;
  /** `overall` (ledning) eller `personal` (eget mål; ledningen kan sätta åt andra). */
  kind?: string;
  owner_user?: string;
}): Promise<GoalActionState> {
  // Övergripande vs personligt avgörs i skrivlagret (`canCreateGoalOfKind`).
  const g = await gate(STAFF_ROLES, 'Bara Movexum-personal kan lägga till mål.');
  if ('error' in g) return { error: g.error };
  const res = await createGoal(await getServerPb(), g.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: 'Målet är tillagt.' };
}

export async function updateGoalFieldAction(input: {
  goalId: string;
  field: GoalWritableField;
  value: string;
}): Promise<GoalActionState> {
  return updateGoalAction({ goalId: input.goalId, patch: { [input.field]: input.value } });
}

/** Redigera ett mål (flera fält i en skrivning). Ledning, eller ägaren av ett personligt mål — avgörs i skrivlagret. */
export async function updateGoalAction(input: {
  goalId: string;
  patch: Partial<Record<GoalWritableField, string>>;
}): Promise<GoalActionState> {
  const g = await gate(STAFF_ROLES, 'Bara Movexum-personal kan ändra mål.');
  if ('error' in g) return { error: g.error };
  const res = await updateGoalFields(await getServerPb(), g.actor, input.goalId, input.patch);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: 'Målet är uppdaterat.' };
}

export async function deleteGoalAction(input: { goalId: string }): Promise<GoalActionState> {
  const g = await gate(STAFF_ROLES, 'Bara Movexum-personal kan ta bort mål.');
  if ('error' in g) return { error: g.error };
  const res = await deleteGoal(await getServerPb(), g.actor, input.goalId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: `Målet "${res.value.title}" är borttaget.` };
}

export async function updateGoalIndicatorAction(input: { indicatorId: string; label?: string; target?: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan ändra indikatorer.');
  if ('error' in g) return { error: g.error };
  const res = await updateGoalIndicator(await getServerPb(), g.actor, input.indicatorId, { label: input.label, target: input.target });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: 'Indikatorn är uppdaterad.' };
}

export async function deleteGoalIndicatorAction(input: { indicatorId: string }): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan ta bort indikatorer.');
  if ('error' in g) return { error: g.error };
  const res = await deleteGoalIndicator(await getServerPb(), g.actor, input.indicatorId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: `Indikatorn "${res.value.label}" är borttagen.` };
}

export async function createGoalIndicatorAction(input: {
  goal: string;
  label: string;
  source: string;
  metric_key?: string;
  survey_module?: string;
  target?: string;
  unit?: string;
  direction?: string;
}): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan lägga till indikatorer.');
  if ('error' in g) return { error: g.error };
  const res = await createGoalIndicator(await getServerPb(), g.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, notice: 'Indikatorn är tillagd.' };
}

export async function recordGoalStatusAction(input: {
  indicator: string;
  quarter: number;
  status: string;
  value?: string;
  comment?: string;
}): Promise<GoalActionState> {
  const g = await gate(STAFF_ROLES, 'Bara Movexum-personal kan rapportera status.');
  if ('error' in g) return { error: g.error };
  const res = await recordGoalStatus(await getServerPb(), g.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  const r = res.value.reading;
  const notice = res.value.skipReason
    ? `Status sparad. ${res.value.skipReason}`
    : r && r.value === null
      ? `Status sparad. Värdet kunde inte beräknas${r.note ? `: ${r.note}` : '.'}`
      : r && !r.complete
        ? 'Status sparad. Underlaget kapades — värdet är en nedre gräns.'
        : 'Status sparad.';
  return { ok: true, id: res.value.entry.id, notice };
}

// ── Import från Excel/CSV (§ 42) ────────────────────────────────────────────

export type GoalImportPreview = {
  periodId: string;
  year: number;
  goals: GoalImportGoal[];
  mappedFields: GoalImportField[];
  unmappedHeaders: string[];
  warnings: string[];
  sheet?: string;
};

export type GoalImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'preview'; preview: GoalImportPreview }
  | { status: 'done'; result: ImportGoalsResult; year: number };

async function resolvePeriod(pb: Awaited<ReturnType<typeof getServerPb>>, tenant: string, periodId: string) {
  try {
    const row = await pb.collection('goal_periods').getOne<{ id: string; tenant: string; year: number; status: string }>(periodId, {
      fields: 'id,tenant,year,status'
    });
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

export async function previewGoalImportAction(_prev: GoalImportState, fd: FormData): Promise<GoalImportState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan importera mål.');
  if ('error' in g) return { status: 'error', message: g.error };
  const periodId = String(fd.get('period') ?? '');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(periodId)) return { status: 'error', message: 'Välj ett verksamhetsår.' };
  const pb = await getServerPb();
  const period = await resolvePeriod(pb, g.actor.tenant, periodId);
  if (!period) return { status: 'error', message: 'Verksamhetsåret hittades inte.' };
  if (period.status === 'closed') return { status: 'error', message: `Verksamhetsåret ${period.year} är avslutat — återöppna det först.` };
  const file = fd.get('file');
  if (!(file instanceof File)) return { status: 'error', message: 'Ingen fil bifogad.' };
  const read = await readTableFile(file, { maxRows: GOAL_IMPORT_MAX_ROWS, rowNoun: 'målrad' });
  if ('error' in read) return { status: 'error', message: read.error };
  const parsed = parseGoalImportRows(read.headers, read.rows);
  return {
    status: 'preview',
    preview: {
      periodId: period.id,
      year: period.year,
      goals: parsed.goals,
      mappedFields: parsed.mappedFields,
      unmappedHeaders: parsed.unmappedHeaders,
      warnings: parsed.warnings,
      sheet: read.sheet
    }
  };
}

export async function commitGoalImportAction(_prev: GoalImportState, fd: FormData): Promise<GoalImportState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan importera mål.');
  if ('error' in g) return { status: 'error', message: g.error };
  const periodId = String(fd.get('period') ?? '');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(periodId)) return { status: 'error', message: 'Verksamhetsåret saknas — ladda upp filen igen.' };
  const raw = fd.get('goals');
  if (typeof raw !== 'string') return { status: 'error', message: 'Förhandsgranskningen saknas — ladda upp filen igen.' };
  let goals: GoalImportGoal[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length > GOAL_IMPORT_MAX_ROWS) throw new Error('bad');
    // Rader från klienten är DATA — varje mål/indikator kör genom skrivlagrets validering.
    goals = parsed as GoalImportGoal[];
  } catch {
    return { status: 'error', message: 'Förhandsgranskningen kunde inte tolkas — ladda upp filen igen.' };
  }
  const pb = await getServerPb();
  const period = await resolvePeriod(pb, g.actor.tenant, periodId);
  if (!period) return { status: 'error', message: 'Verksamhetsåret hittades inte.' };
  const res = await importGoals(pb, g.actor, period.id, goals);
  if (!res.ok) return { status: 'error', message: res.error };
  revalidate();
  return { status: 'done', result: res.value, year: period.year };
}
