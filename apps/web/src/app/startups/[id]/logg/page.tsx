import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';
import { LogTab, type LogEntry } from '@/components/intric/LogTab';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
}

interface ActivityRow {
  id: string;
  startup?: string;
  kind?: string;
  title?: string;
  description?: string;
  type?: string;
  tool?: string;
  tool_run?: string;
  owner?: string;
  created: string;
  expand?: {
    owner?: { id: string; display_name?: string; email: string };
    tool_run?: { id: string; output_md?: string };
  };
}

function displayName(u?: { display_name?: string; email: string }): string {
  return u?.display_name || u?.email || 'system';
}

export default async function StartupLogPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();

  let startup: StartupRow;
  try {
    startup = await getOneForTenant<StartupRow>('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();

  let activities: ActivityRow[] = [];
  try {
    const res = await pb.collection('activities').getList<ActivityRow>(1, 100, {
      filter: `startup = "${id}"`,
      sort: '-created',
      expand: 'owner,tool_run'
    });
    activities = res.items;
  } catch {
    activities = [];
  }

  const entries: LogEntry[] = activities.map((a) => ({
    id: a.id,
    kind: a.kind || a.type || 'manual',
    actor: displayName(a.expand?.owner),
    title: a.title || 'Aktivitet',
    meta: a.description?.replace(/<[^>]*>/g, '').trim() || undefined,
    artefact: a.tool_run ? undefined : undefined,
    toolRunId: a.tool_run,
    startupId: a.startup,
    created: a.created
  }));

  return <LogTab entries={entries} startupName={startup.name} />;
}
