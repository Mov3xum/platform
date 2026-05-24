// Movexum OS — Nytt projekt/uppdrag
// Formulär för att skapa ett nytt projekt eller uppdrag. Stages auto-genereras utifrån typ.
// Tillgängligt för alla medlemmar utom observer.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_ROLES, type Role } from '@platform/shared';
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

const MEMBER_ROLES: Role[] = ALL_ROLES.filter((r) => r !== 'observer');

export default async function NewMissionPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, MEMBER_ROLES)) {
    redirect('/uppdrag');
  }

  const pb = await getServerPb();
  let users: UserOption[] = [];
  let startups: StartupOption[] = [];

  try {
    const res = await pb.collection('users').getList(1, 200, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: 'display_name',
      fields: 'id,display_name,email'
    });
    users = res.items.map((u) => {
      const rec = u as unknown as { id: string; display_name?: string; email?: string };
      const local = rec.email ? rec.email.split('@')[0] : rec.id;
      return { id: String(rec.id), label: rec.display_name || local };
    });
  } catch {
    /* ignore */
  }

  try {
    const res = await pb.collection('startups').getList(1, 100, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
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
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Hemmaplan / Projekt & uppdrag / Nytt"
        title="Nytt projekt"
        subtitle="Bjud in deltagare, koppla bolag och starta samarbetet. Stegen i flödet skapas utifrån typ."
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
