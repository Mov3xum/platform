import { type Role } from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import { getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { unstable_cache } from 'next/cache';
import { ProtoShell } from './proto/ProtoShell';

type AppShellProps = {
  user: SessionUser;
  children: React.ReactNode;
};

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

  return (
    <ProtoShell user={user} counts={{ education: assignedWorkshopCount }}>
      {children}
    </ProtoShell>
  );
}
