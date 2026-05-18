import { type Role, type StartupPhase } from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import { getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { unstable_cache } from 'next/cache';
import { ProtoShell } from './proto/ProtoShell';
import type { SwitchableStartup } from './proto/StartupSwitcher';

type AppShellProps = {
  user: SessionUser;
  children: React.ReactNode;
};

interface StartupListItem {
  id: string;
  name: string;
  phase?: StartupPhase | string;
  tags?: string;
}

const getAssignedWorkshopCount = unstable_cache(
  async (tenant: string, linkedStartupsKey: string) => {
    if (!linkedStartupsKey) return 0;
    const linkedStartups = linkedStartupsKey.split(',').filter(Boolean);
    if (linkedStartups.length === 0) return 0;

    const pb = await getServerPb();
    const linkedFilter = linkedStartups.map((id) => `startup = "${id}"`).join(' || ');
    const result = await pb.collection(PB_COLLECTIONS.workshopAssignments).getList(1, 1, {
      filter: `tenant = "${tenant}" && status != "done" && (${linkedFilter})`
    });
    return result.totalItems;
  },
  ['assigned-workshop-count'],
  { revalidate: 300 }
);

async function loadSwitchableStartups(user: SessionUser): Promise<SwitchableStartup[]> {
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  try {
    if (isStaff) {
      const res = await pb.collection('startups').getList<StartupListItem>(1, 200, {
        filter: pb.filter('tenant = {:tenant} && status = "active"', { tenant: user.tenant }),
        sort: 'name',
        fields: 'id,name,phase,tags'
      });
      return res.items.map((s) => ({
        id: s.id,
        name: s.name,
        phase: s.phase ? String(s.phase) : undefined,
        industry: s.tags
      }));
    }

    // Founder/observer: bara linkedStartups
    if (user.linkedStartups.length === 0) return [];
    const filter = user.linkedStartups.map((id) => `id = "${id}"`).join(' || ');
    const res = await pb.collection('startups').getList<StartupListItem>(1, 50, {
      filter,
      sort: 'name',
      fields: 'id,name,phase,tags'
    });
    return res.items.map((s) => ({
      id: s.id,
      name: s.name,
      phase: s.phase ? String(s.phase) : undefined,
      industry: s.tags
    }));
  } catch {
    return [];
  }
}

export async function AppShell({ user, children }: AppShellProps) {
  const roles = user.roles as Role[];
  let assignedWorkshopCount = 0;

  if (roles.includes('startup_member') && user.linkedStartups.length > 0) {
    try {
      assignedWorkshopCount = await getAssignedWorkshopCount(
        user.tenant,
        user.linkedStartups.join(',')
      );
    } catch {
      assignedWorkshopCount = 0;
    }
  }

  const switchableStartups = await loadSwitchableStartups(user);

  return (
    <ProtoShell
      user={user}
      counts={{ education: assignedWorkshopCount }}
      switchableStartups={switchableStartups}
    >
      {children}
    </ProtoShell>
  );
}
