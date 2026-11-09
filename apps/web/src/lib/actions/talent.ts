'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import {
  createTalentNeed,
  deleteStudentProfile,
  deleteTalentNeed,
  proposeStudentForNeed,
  setInterestStatus,
  setStudentProfileStatus,
  setTalentNeedStatus,
  updateTalentNeed,
  type Actor,
  type TalentAccess
} from '@/lib/core/write';
import { isTalentId, isTalentNeedStatus } from '@platform/shared';

/**
 * Studenter & talang (CLAUDE.md § 54) — tunna server actions. RBAC-grind här
 * (bolagsmedlem för sitt eget bolag, staff för alla), allt annat —
 * validering, tenant, statusmaskin, notiser, audit — i
 * `lib/core/write/talent.ts`.
 */

export interface TalentActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  warning?: string;
  id?: string;
  path?: string;
}

const STAFF = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}
function accessOf(user: SessionUser): TalentAccess {
  return { linkedStartups: user.linkedStartups };
}
function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/** Staff via modulen, eller en bolagsmedlem länkad till minst ett bolag. */
async function session(): Promise<{ user: SessionUser; actor: Actor; access: TalentAccess; isStaff: boolean } | { error: string }> {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, [...STAFF]) && canAccessModuleForUser(user.roles, 'talang', user.enabledModules);
  const isMember = hasRole(user.roles, ['startup_member']) && user.linkedStartups.length > 0;
  if (!isStaff && !isMember) return { error: 'Du har inte tillgång till Studenter & talang.' };
  return { user, actor: actorOf(user), access: accessOf(user), isStaff };
}

function revalidate(needId?: string, startupId?: string) {
  revalidatePath('/talang', 'layout');
  revalidatePath('/min-oversikt', 'layout');
  if (needId) {
    revalidatePath(`/talang/behov/${needId}`);
    revalidatePath(`/min-oversikt/talang/${needId}`);
  }
  if (startupId) revalidatePath(`/startups/${startupId}/natverk`);
}

function fieldsFrom(fd: FormData): Record<string, unknown> {
  return {
    title: str(fd, 'title'),
    kind: str(fd, 'kind'),
    description: str(fd, 'description'),
    tags: fd.getAll('tags').filter((t): t is string => typeof t === 'string'),
    scope: str(fd, 'scope'),
    starts_at: str(fd, 'starts_at'),
    ends_at: str(fd, 'ends_at'),
    compensation: str(fd, 'compensation'),
    compensation_note: str(fd, 'compensation_note'),
    location: str(fd, 'location'),
    work_mode: str(fd, 'work_mode'),
    supervisor: str(fd, 'supervisor') === 'on',
    deadline: str(fd, 'deadline'),
    anonymous: str(fd, 'anonymous') === 'on'
  };
}

export async function createTalentNeedAction(_prev: TalentActionState, fd: FormData): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const startupId = str(fd, 'startup') || ctx.user.linkedStartups[0] || '';
  if (!isTalentId(startupId)) return { error: 'Välj vilket bolag behovet gäller.' };
  const pb = await getServerPb();
  const res = await createTalentNeed(pb, ctx.actor, ctx.access, startupId, fieldsFrom(fd), { submit: str(fd, 'intent') === 'submit' });
  if (!res.ok) return { error: res.error };
  revalidate(res.value.needId, startupId);
  return {
    ok: true,
    id: res.value.needId,
    path: res.value.path,
    notice: res.value.status === 'pending_review' ? 'Behovet är skickat till Movexum för granskning.' : 'Utkastet är sparat.'
  };
}

export async function updateTalentNeedAction(_prev: TalentActionState, fd: FormData): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const needId = str(fd, 'need');
  const pb = await getServerPb();
  const res = await updateTalentNeed(pb, ctx.actor, ctx.access, needId, fieldsFrom(fd));
  if (!res.ok) return { error: res.error };
  revalidate(needId);
  return { ok: true, id: needId, path: res.value.path, notice: 'Behovet är sparat.', warning: res.value.warning };
}

export async function setTalentNeedStatusAction(needId: string, to: string, note?: string): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  if (!isTalentNeedStatus(to)) return { error: 'Okänd status.' };
  const pb = await getServerPb();
  const res = await setTalentNeedStatus(pb, ctx.actor, ctx.access, needId, to, { note });
  if (!res.ok) return { error: res.error };
  revalidate(needId);
  return { ok: true, id: needId, path: res.value.path };
}

export async function deleteTalentNeedAction(needId: string): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const res = await deleteTalentNeed(pb, ctx.actor, ctx.access, needId);
  if (!res.ok) return { error: res.error };
  revalidate(needId);
  return { ok: true, notice: `"${res.value.title}" togs bort.` };
}

export async function proposeStudentAction(needId: string, studentId: string, message?: string): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const origin = await requestOrigin();
  if (!origin) return { error: 'Appens adress är inte konfigurerad (APP_URL) — länken i mejlet kan inte byggas.' };
  const res = await proposeStudentForNeed(pb, ctx.actor, ctx.access, needId, studentId, {
    message,
    origin,
    tenantSlug: ctx.user.tenantSlug ?? ''
  });
  if (!res.ok) return { error: res.error };
  revalidate(needId);
  return { ok: true, id: res.value.interestId, notice: 'Förslaget är skickat till studenten, som själv avgör.' };
}

export async function setInterestStatusAction(
  interestId: string,
  to: string,
  extra: { outcome?: string; outcomeNote?: string; companyNote?: string } = {}
): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const res = await setInterestStatus(pb, ctx.actor, ctx.access, interestId, to, extra);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.needId);
  return { ok: true, id: interestId };
}

export async function setStudentStatusAction(studentId: string, to: string): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  if (!ctx.isStaff) return { error: 'Bara Movexum-personal kan ändra studentprofiler.' };
  const pb = await getServerPb();
  const res = await setStudentProfileStatus(pb, ctx.actor, studentId, to);
  if (!res.ok) return { error: res.error };
  revalidate();
  revalidatePath(`/talang/studenter/${studentId}`);
  return { ok: true };
}

export async function deleteStudentAction(studentId: string): Promise<TalentActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const res = await deleteStudentProfile(pb, ctx.actor, studentId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Profilen är borttagen.' };
}
