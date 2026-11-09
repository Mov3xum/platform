import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getOneForTenant } from '@/lib/pb.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import type { StartupRecord } from './types';

/**
 * Gemensam laddning för bolagskortets flikar. React `cache` gör att layout
 * och flik delar EN läsning av bolaget per request. Åtkomst: modulen
 * `startups` + att bolaget kan läsas med användarens token (RLS § 21 —
 * en bolagsmedlem når bara sina egna bolag) — annars 404.
 */
export const loadStartupPage = cache(async (id: string) => {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();
  let startup: StartupRecord;
  try {
    startup = await getOneForTenant<StartupRecord>('startups', id);
  } catch {
    notFound();
  }
  const pb = await getServerPb();
  const isLinkedMember = hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(id);
  return {
    user,
    startup,
    pb,
    flags: {
      /** Redigera bolaget (speglar edit-sidan). */
      canEdit: hasRole(user.roles, ['admin', 'incubator_lead', 'coach']),
      /** Movexum-personal (skriver anteckningar, IRL, dokument m.m.). */
      isStaff: hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']),
      /** Personal + observer — läser interna sektioner (RLS staff/observer). */
      isStaffOrObserver: hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor', 'observer']),
      isLinkedMember
    }
  };
});
