import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { loadGoalWorkspace } from '@/lib/goals/data';
import { currentQuarter } from '@/lib/core/write';
import type { Role } from '@platform/shared';
import { GoalsView } from './GoalsView';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

/**
 * Mål & verksamhetsplan (CLAUDE.md § 42) — målträdet per verksamhetsår med
 * kvartalsstatus och live-värden ur metrikregistret (§ 41). Reads via
 * användarens token (RLS § 21); skrivningar via server actions → det delade
 * skrivlagret. Ingen AI-inferens på sidan.
 */
export default async function MalPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'mal', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const yearRaw = typeof sp.ar === 'string' ? Number(sp.ar) : NaN;
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : null;
  const quarterRaw = typeof sp.q === 'string' ? Number(sp.q) : NaN;
  const quarter = quarterRaw >= 1 && quarterRaw <= 4 ? (quarterRaw as 1 | 2 | 3 | 4) : currentQuarter();
  const focusGoal = typeof sp.mal === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(sp.mal) ? sp.mal : null;

  const pb = await getServerPb();
  const ws = await loadGoalWorkspace(pb, user.tenant, user.id, user.roles, year);

  return (
    <PageShell
      title="Mål & verksamhetsplan"
      meta={
        <span className="text-sm text-foreground-subtle">
          {ws.period ? `${ws.period.title || ws.period.year} · ${ws.tree.indicatorCount} indikatorer` : 'Inget verksamhetsår ännu'}
        </span>
      }
    >
      <GoalsView
        workspace={ws}
        quarter={quarter}
        focusGoal={focusGoal}
        currentUserId={user.id}
        canReport={hasRole(user.roles, STAFF_ROLES)}
        canManage={hasRole(user.roles, LEAD_ROLES)}
      />
    </PageShell>
  );
}
