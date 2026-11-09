import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type PocketBase from 'pocketbase';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import type { PageTab } from '@/components/PageShell';

/** Grind för /talang (§ 54): modulen + Movexum-personal/observer. En per request. */
export const requireTalentStaff = cache(async (): Promise<{ user: SessionUser; pb: PocketBase; canManage: boolean; isLead: boolean }> => {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'talang', user.enabledModules)) redirect('/hem');
  return {
    user,
    pb: await getServerPb(),
    canManage: hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']),
    isLead: hasRole(user.roles, ['admin', 'incubator_lead'])
  };
});

export function talentTabs(badges: { review?: number } = {}): PageTab[] {
  return [
    { id: 'behov', label: 'Behov', href: '/talang', badge: badges.review },
    { id: 'studenter', label: 'Studenter', href: '/talang/studenter' },
    { id: 'matchningar', label: 'Matchningar', href: '/talang/matchningar' },
    { id: 'publik', label: 'Studentsidan', href: '/talang/publik' }
  ];
}

export const TALENT_INTRO =
  'Bolagen lägger upp behov (exjobb, praktik, deltid, anställning), Movexum granskar och publicerar, studenter registrerar sig på den publika studentsidan. Matchningen är deterministisk på hashtags — ni och bolagen beslutar, ingen AI bedömer studenter.';
