// Movexum OS — Nytt uppdrag
// Formulär för att skapa ett nytt uppdrag. Stages auto-genereras utifrån typ.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Icon } from '@/components/proto';
import { NewMissionForm } from './NewMissionForm';
import { createMissionAction } from '@/lib/actions/missions';

interface UserOption {
  id: string;
  label: string;
}
interface StartupOption {
  id: string;
  name: string;
}

export default async function NewMissionPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/uppdrag');
  }

  const pb = await getServerPb();
  let users: UserOption[] = [];
  let startups: StartupOption[] = [];

  try {
    const res = await pb.collection('users').getList(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: 'display_name'
    });
    users = res.items.map((u) => {
      const rec = u as unknown as { id: string; display_name?: string; email?: string };
      return { id: String(rec.id), label: rec.display_name || rec.email || rec.id };
    });
  } catch {
    /* ignore */
  }

  try {
    const res = await pb.collection('startups').getList(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: 'name'
    });
    startups = res.items.map((s) => {
      const rec = s as unknown as { id: string; name: string };
      return { id: String(rec.id), name: rec.name };
    });
  } catch {
    /* ignore */
  }

  return (
    <div className="mx-view-pad mx-narrow" style={{ padding: '20px 24px' }}>
      <PageHead
        crumb="Hemmaplan / Uppdrag & flöden / Nytt"
        title="Nytt uppdrag"
        subtitle="Tilldela ett uppdrag till en eller flera mottagare. Stegen i flödet skapas utifrån typ."
        actions={
          <Link href="/uppdrag" className="mx-btn mx-sm mx-ghost">
            <Icon name="arrow" size={12} /> Tillbaka
          </Link>
        }
      />

      <NewMissionForm
        action={createMissionAction}
        users={users}
        startups={startups}
        currentUserId={user.id}
      />
    </div>
  );
}
