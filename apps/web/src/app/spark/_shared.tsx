import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { ReactNode } from 'react';
import type PocketBase from 'pocketbase';
import {
  SPARK_ENERGY_AREA_LABELS,
  SPARK_INTERVIEW_STATUS_LABELS,
  SPARK_MATCH_STATUS_LABELS,
  SPARK_ROLE_LABELS,
  type SparkInterviewStatus,
  type SparkMatchStatus,
  type SparkRole
} from '@platform/shared';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import type { PageTab } from '@/components/PageShell';
import { Chip } from '@/components/talent/ui';

/**
 * Grind för /spark (CLAUDE.md § 61). `staff` = Movexum-personal + observer
 * (läser registret), `canManage` = admin/incubator_lead/coach, `partner` =
 * en ren partner (Högskolan, en kommun) som bara når intervjuer, delning och
 * import. En per request.
 */
export const requireSpark = cache(
  async (): Promise<{ user: SessionUser; pb: PocketBase; canManage: boolean; isLead: boolean; staff: boolean; partner: boolean }> => {
    const user = await requireUser();
    if (!canAccessModuleForUser(user.roles, 'spark', user.enabledModules)) redirect('/hem');
    const canManage = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
    const staff = canManage || hasRole(user.roles, ['observer']);
    return { user, pb: await getServerPb(), canManage, isLead: hasRole(user.roles, ['admin', 'incubator_lead']), staff, partner: !staff };
  }
);

/** Sidor som bara Movexum-personal och observer når — en partner skickas till sina intervjuer. */
export async function requireSparkStaff() {
  const ctx = await requireSpark();
  if (!ctx.staff) redirect('/spark/intervjuer');
  return ctx;
}

export function sparkTabs(staff: boolean, badges: { submitted?: number } = {}): PageTab[] {
  const interviews: PageTab = { id: 'intervjuer', label: 'Intervjuer', href: '/spark/intervjuer', badge: badges.submitted };
  const share: PageTab = { id: 'dela', label: 'Dela', href: '/spark/dela' };
  const imp: PageTab = { id: 'import', label: 'Import', href: '/spark/import' };
  if (!staff) return [interviews, share, imp];
  return [
    { id: 'oversikt', label: 'Översikt', href: '/spark' },
    interviews,
    { id: 'aktorer', label: 'Aktörer', href: '/spark/aktorer' },
    { id: 'matchning', label: 'Matchning', href: '/spark/matchning' },
    { id: 'accelerator', label: 'Accelerator', href: '/spark/accelerator' },
    share,
    imp
  ];
}

export function RoleChips({ roles }: { roles: readonly SparkRole[] }): ReactNode {
  if (roles.length === 0) return <Chip>Nätverk</Chip>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Chip key={r} tone={r === 'need_owner' ? 'info' : r === 'innovator' ? 'success' : 'accent'}>
          {SPARK_ROLE_LABELS[r]}
        </Chip>
      ))}
    </span>
  );
}

export function AreaChips({ areas, highlight }: { areas: readonly string[]; highlight?: readonly string[] }): ReactNode {
  if (areas.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {areas.map((a) => (
        <Chip key={a} tone={highlight?.includes(a) ? 'success' : 'neutral'}>
          {SPARK_ENERGY_AREA_LABELS[a] ?? a}
        </Chip>
      ))}
    </span>
  );
}

const INTERVIEW_TONE: Record<SparkInterviewStatus, 'neutral' | 'warning' | 'success'> = { draft: 'neutral', submitted: 'warning', applied: 'success' };
export function InterviewStatusChip({ status }: { status: SparkInterviewStatus }): ReactNode {
  return <Chip tone={INTERVIEW_TONE[status]}>{SPARK_INTERVIEW_STATUS_LABELS[status]}</Chip>;
}

const MATCH_TONE: Record<SparkMatchStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent'> = {
  suggested: 'neutral',
  introduced: 'info',
  dialogue: 'info',
  pilot_planned: 'accent',
  pilot_running: 'warning',
  completed: 'success',
  declined: 'danger'
};
export function MatchStatusChip({ status }: { status: SparkMatchStatus }): ReactNode {
  return <Chip tone={MATCH_TONE[status]}>{SPARK_MATCH_STATUS_LABELS[status]}</Chip>;
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">{children}</div>;
}

export const SPARK_TITLE = 'SPARK – energimatchning';
