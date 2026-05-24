// Movexum OS — Uppdrag/Projekt detalj
// Visar fullt flöde + artefakter + deltagare + kommentarer för ett enskilt uppdrag.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Icon } from '@/components/proto';
import { MissionFlow } from '@/components/MissionFlow';
import { MissionComments } from '@/components/missions/MissionComments';
import { ParticipantsPanel } from '@/components/missions/ParticipantsPanel';
import { MissionStartupsChips } from '@/components/missions/MissionStartupsChips';
import { getMissionContext, getStartupIds } from '@/lib/missions-server';
import { deleteMissionFormAction } from '@/lib/actions/missions';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Mission, MissionComment, MissionParticipant } from '@platform/shared';

interface UserOption {
  id: string;
  label: string;
}

export default async function MissionDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission | null = null;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id, {
      expand: 'issuer,recipients,mentor,startup,startups'
    });
  } catch {
    notFound();
  }
  if (!mission) notFound();
  if (mission.tenant !== user.tenant) redirect('/uppdrag');

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canView) redirect('/uppdrag');

  // Hämta tenant-användare (för @mention-autocomplete + deltagar-picker)
  let users: UserOption[] = [];
  try {
    const res = await pb.collection('users').getList(1, 200, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: 'display_name',
      fields: 'id,display_name,email'
    });
    users = res.items.map((u) => {
      const rec = u as unknown as { id: string; display_name?: string; email?: string };
      const local = rec.email ? rec.email.split('@')[0] : rec.id;
      return { id: rec.id, label: rec.display_name || local };
    });
  } catch {
    /* ignore */
  }

  // Hämta kommentarer
  let comments: MissionComment[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.missionComments).getList<MissionComment>(1, 200, {
      filter: pb.filter('mission = {:m}', { m: mission.id }),
      sort: 'created',
      expand: 'author'
    });
    comments = res.items;
  } catch {
    /* ignore */
  }

  // Hämta startups (multi)
  const startupIds = getStartupIds(mission);
  const startupRefs: Array<{ id: string; name: string }> = [];
  if (startupIds.length > 0) {
    try {
      const ids = startupIds.map((sid) => `id = "${sid.replace(/"/g, '')}"`).join(' || ');
      const res = await pb.collection('startups').getList(1, 50, {
        filter: pb.filter(`tenant = {:t} && (${ids})`, { t: user.tenant }),
        fields: 'id,name'
      });
      for (const sid of startupIds) {
        const found = res.items.find((s) => (s as unknown as { id: string }).id === sid);
        if (found) {
          const rec = found as unknown as { id: string; name: string };
          startupRefs.push({ id: rec.id, name: rec.name });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Förbered deltagar-data
  const rawParticipants: MissionParticipant[] = Array.isArray(mission.participants_json)
    ? mission.participants_json
    : [];
  const participantsForUi =
    rawParticipants.length > 0
      ? rawParticipants.map((p) => ({ user_id: p.user_id, role: p.role }))
      : [
          { user_id: mission.issuer, role: 'lead' as const },
          ...(mission.recipients || [])
            .filter((rid) => rid !== mission.issuer)
            .map((rid) => ({ user_id: rid, role: 'contributor' as const })),
          ...(mission.mentor && mission.mentor !== mission.issuer
            ? [{ user_id: mission.mentor, role: 'observer' as const }]
            : [])
        ];

  return (
    <div
      className="mx-view-pad mx-wide"
      style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <PageHead
        crumb="Hemmaplan / Projekt & uppdrag / Detalj"
        title={mission.title}
        subtitle={`${mission.type === 'project' ? 'Projekt' : 'Uppdrag'} · ${mission.id.slice(0, 8)} · ${mission.type.replace('_', ' ')}`}
        actions={
          <>
            <Link href="/uppdrag" className="mx-btn mx-sm mx-ghost">
              <Icon name="arrow" size={12} /> Alla projekt
            </Link>
            <Link
              href={{ pathname: '/uppdrag', query: { m: mission.id } }}
              className="mx-btn mx-sm"
            >
              Öppna i flödesvy
            </Link>
            {ctx.canEdit ? (
              <>
                <Link href={`/uppdrag/${mission.id}/edit`} className="mx-btn mx-sm mx-ghost">
                  Redigera
                </Link>
                <ConfirmDeleteButton
                  action={deleteMissionFormAction}
                  hiddenField={{ name: 'mission_id', value: mission.id }}
                  label="Radera"
                  variant="ghost"
                  description={`Radera "${mission.title}"? Detta går inte att ångra.`}
                />
              </>
            ) : null}
          </>
        }
      />

      {startupRefs.length > 0 && <MissionStartupsChips startups={startupRefs} />}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
          gap: 16,
          alignItems: 'start'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <MissionFlow
            mission={mission}
            currentUserId={user.id}
            canAdvance={ctx.canAdvanceStage}
          />
          <MissionComments
            missionId={mission.id}
            comments={comments}
            users={users}
            currentUserId={user.id}
            canComment={ctx.canComment}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <ParticipantsPanel
            missionId={mission.id}
            issuerId={mission.issuer}
            users={users}
            initialParticipants={participantsForUi}
            canEdit={ctx.canEdit}
          />
        </div>
      </div>
    </div>
  );
}
