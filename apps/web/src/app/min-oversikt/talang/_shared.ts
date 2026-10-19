import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type PocketBase from 'pocketbase';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';

/**
 * Grind för bolagets vy (§ 54): en bolagsmedlem länkad till ett bolag, eller
 * Movexum-personal med ett länkat bolag ("Mitt bolag"). Allt scopas till
 * `linkedStartups[0]` — aldrig portföljbred data.
 */
export const requireMemberStartup = cache(async (): Promise<{ user: SessionUser; pb: PocketBase; startupId: string; startupName: string; isStaff: boolean }> => {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'min_oversikt', user.enabledModules)) redirect('/chatt');
  const startupId = user.linkedStartups[0];
  if (!startupId) redirect('/min-oversikt');
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isMember = hasRole(user.roles, ['startup_member']);
  if (!isStaff && !isMember) redirect('/min-oversikt');
  const pb = await getServerPb();
  let startupName = 'Mitt bolag';
  try {
    const s = await pb.collection('startups').getOne<{ tenant?: string; name?: string }>(startupId, { fields: 'id,tenant,name' });
    if (String(s.tenant ?? '') !== user.tenant) redirect('/min-oversikt');
    startupName = s.name ?? startupName;
  } catch {
    redirect('/min-oversikt');
  }
  return { user, pb, startupId, startupName, isStaff };
});
