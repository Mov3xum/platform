import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';
import { ChatTab } from '@/components/intric/ChatTab';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
}

export default async function StartupChatPage({
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

  return <ChatTab startupId={startup.id} startupName={startup.name} />;
}
