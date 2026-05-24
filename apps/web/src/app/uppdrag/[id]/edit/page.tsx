import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { getMissionContext } from '@/lib/missions-server';
import {
  updateMissionAction,
  deleteMissionFormAction
} from '@/lib/actions/missions';
import { MissionEditForm } from './MissionEditForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Mission } from '@platform/shared';

export default async function EditMissionPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    notFound();
  }
  if (mission.tenant !== user.tenant) redirect('/uppdrag');

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canEdit) redirect(`/uppdrag/${id}`);

  const boundAction = updateMissionAction.bind(null, id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/uppdrag/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {mission.title}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera uppdrag</h1>
        <p className="mt-2 text-sm text-foreground-muted">{mission.title}</p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <MissionEditForm action={boundAction} mission={mission} />
      </div>

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Raderar uppdraget. Kommentarer och kopplade poster försvinner.
        </p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteMissionFormAction}
            hiddenField={{ name: 'mission_id', value: id }}
            label="Radera uppdrag"
            description={`Du raderar "${mission.title}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
