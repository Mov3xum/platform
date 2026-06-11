import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import {
  isStartupBoardStatus,
  type StartupBoardStatus,
  type StartupBoardTask
} from '@/lib/startup-board/board';
import type { Role } from '@platform/shared';
import { StartupKanban } from './StartupKanban';

// Fliken "Aktiviteter" på bolagskortet (CLAUDE.md § 15.7): kanban över
// bolagets uppgifter (tasks, link_kind='startup') i sex kolumner där
// Movexum-kollegor tilldelas kort och flyttar dem tillsammans.
//
// Reads går via användarens auth-token → PB-RLS (§ 21) gäller: en
// bolagsmedlem ser bara sitt eget bolags uppgifter, staff ser tenantens.

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

interface UserRef {
  id: string;
  display_name?: string;
  email: string;
}

interface TaskRow {
  id: string;
  kind: string;
  description: string;
  due_at?: string;
  status: string;
  owner?: string;
  assignees?: string[];
  expand?: { owner?: UserRef; assignees?: UserRef[] };
}

function nameOf(u?: UserRef): string {
  return u?.display_name || (u?.email ? u.email.split('@')[0] : '');
}

export default async function StartupActivitiesPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();

  try {
    await getOneForTenant('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, STAFF_ROLES);

  const [tasksRes, resources] = await Promise.all([
    pb
      .collection('tasks')
      .getList<TaskRow>(1, 200, {
        filter: pb.filter(
          'tenant = {:t} && startup = {:s} && status != "cancelled"',
          { t: user.tenant, s: id }
        ),
        sort: '-created',
        expand: 'owner,assignees'
      })
      .catch(() => ({ items: [] as TaskRow[] })),
    isStaff ? listAssignableResourcesForTenant(pb, user.tenant) : Promise.resolve([])
  ]);

  const tasks: StartupBoardTask[] = tasksRes.items
    .filter((t) => isStartupBoardStatus(t.status))
    .map((t) => ({
      id: t.id,
      status: t.status as StartupBoardStatus,
      title: t.description,
      kind: t.kind,
      dueAt: t.due_at || undefined,
      ownerId: t.owner || undefined,
      ownerName: nameOf(t.expand?.owner) || undefined,
      assignees: (t.expand?.assignees || []).map((a) => ({
        id: a.id,
        name: nameOf(a)
      })),
      canEdit: isStaff || (!!t.owner && t.owner === user.id)
    }));

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-10">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">Aktiviteter</h2>
        <p className="mt-1 text-sm text-foreground-subtle">
          Bolagets gemensamma tavla — tilldela kollegor och flytta kort mellan
          kolumnerna.
        </p>
      </div>
      <StartupKanban
        startupId={id}
        tasks={tasks}
        resources={resources}
        canManage={isStaff}
      />
    </div>
  );
}
