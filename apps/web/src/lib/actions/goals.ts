'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createGoal,
  createGoalIndicator,
  createGoalPeriod,
  recordGoalStatus,
  setGoalPeriodStatus,
  updateGoalField,
  type Actor,
  type GoalWritableField
} from '@/lib/core/write';
import type { Role } from '@platform/shared';

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
}): Promise<GoalActionState> {
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan lägga till mål.');
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
  const g = await gate(LEAD_ROLES, 'Bara admin/incubator_lead kan ändra mål.');
  if ('error' in g) return { error: g.error };
  const res = await updateGoalField(await getServerPb(), g.actor, input.goalId, input.field, input.value);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id };
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
