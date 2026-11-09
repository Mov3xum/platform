'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createFundingProject,
  createFundingWorkPackage,
  deleteFundingProject,
  deleteFundingWorkPackage,
  updateFundingProjectFields,
  updateFundingWorkPackageFields,
  type Actor
} from '@/lib/core/write';
import type { FundingProjectInputRaw, FundingWorkPackageInputRaw, Role } from '@platform/shared';

/** Server actions för finansieringsprojekt & arbetspaket (§ 46.3). Ledning (admin/incubator_lead). */

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface FundingActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  id?: string;
  path?: string;
}

async function lead(): Promise<{ actor: Actor } | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan hantera finansieringsprojekt.' };
  return { actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles } };
}

function revalidate(projectId?: string) {
  revalidatePath('/projekt');
  if (projectId) revalidatePath(`/projekt/${projectId}`);
  revalidatePath('/checkar');
  revalidatePath('/checkar/typer');
}

export async function createFundingProjectAction(input: FundingProjectInputRaw & { responsible?: string | null }): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await createFundingProject(pb, s.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.projectId);
  return { ok: true, id: res.value.projectId, path: res.value.path };
}

export async function updateFundingProjectAction(projectId: string, input: FundingProjectInputRaw & { responsible?: string | null }): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await updateFundingProjectFields(pb, s.actor, projectId, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.projectId);
  return { ok: true, id: res.value.projectId, path: res.value.path, notice: 'Projektet sparat.' };
}

export async function deleteFundingProjectAction(projectId: string): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await deleteFundingProject(pb, s.actor, projectId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, path: '/projekt' };
}

export async function deleteFundingProjectFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get('project_id') ?? '');
  const res = await deleteFundingProjectAction(id);
  if (res.error) throw new Error(res.error);
}

export async function createWorkPackageAction(projectId: string, input: FundingWorkPackageInputRaw): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await createFundingWorkPackage(pb, s.actor, projectId, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.projectId);
  return { ok: true, id: res.value.workPackageId, path: res.value.path };
}

export async function updateWorkPackageAction(workPackageId: string, input: FundingWorkPackageInputRaw): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await updateFundingWorkPackageFields(pb, s.actor, workPackageId, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.projectId);
  return { ok: true, id: res.value.workPackageId, path: res.value.path, notice: 'Arbetspaketet sparat.' };
}

export async function deleteWorkPackageAction(workPackageId: string): Promise<FundingActionState> {
  const s = await lead();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await deleteFundingWorkPackage(pb, s.actor, workPackageId);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.projectId);
  return { ok: true };
}
