// Movexum OS — Uppdrag/Projekt detalj
// Visar fullt flöde + artefakter + deltagare + kommentarer för ett enskilt uppdrag.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getPublicPbUrl } from '@/lib/pb-url';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import {
  isStartupBoardStatus,
  type StartupBoardStatus,
  type StartupBoardTask
} from '@/lib/startup-board/board';
import { PageHead, Icon } from '@/components/proto';
import { MissionFlow } from '@/components/MissionFlow';
import { MissionComments } from '@/components/missions/MissionComments';
import { ParticipantsPanel } from '@/components/missions/ParticipantsPanel';
import { MissionStartupsChips } from '@/components/missions/MissionStartupsChips';
import { getMissionContext, getStartupIds } from '@/lib/missions-server';
import { deleteMissionFormAction } from '@/lib/actions/missions';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { TeamCompetencePanel, type TeamMemberView } from './TeamCompetencePanel';
import { MissionTaskBoard } from './MissionTaskBoard';
import { MissionDocuments, type MissionDocView } from './MissionDocuments';
import { sanitizeCompetences } from '@platform/shared';
import type { Mission, MissionComment, MissionParticipant, MissionDocument, CompetenceId, Role } from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

interface TaskRow {
  id: string;
  kind: string;
  description: string;
  due_at?: string;
  status: string;
  owner?: string;
  assignees?: string[];
  expand?: {
    owner?: { id: string; display_name?: string; email: string };
    assignees?: Array<{ id: string; display_name?: string; email: string }>;
  };
}

function userName(u?: { display_name?: string; email?: string }): string {
  return u?.display_name || (u?.email ? u.email.split('@')[0] : '');
}

interface UserOption {
  id: string;
  label: string;
}
interface UserMeta {
  title?: string;
  competences: CompetenceId[];
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

  // Hämta tenant-användare (för @mention-autocomplete + deltagar-picker) inkl.
  // kompetenser/titel för "Team & kompetenser"-panelen (§ 29).
  let users: UserOption[] = [];
  const userMeta = new Map<string, UserMeta>();
  try {
    const res = await pb.collection('users').getList(1, 200, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: 'display_name',
      fields: 'id,display_name,email,title,competences'
    });
    users = res.items.map((u) => {
      const rec = u as unknown as {
        id: string;
        display_name?: string;
        email?: string;
        title?: string;
        competences?: unknown;
      };
      const local = rec.email ? rec.email.split('@')[0] : rec.id;
      userMeta.set(rec.id, {
        title: rec.title || undefined,
        competences: sanitizeCompetences(rec.competences)
      });
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

  // ── Uppdragskanban (§ 29): tasks länkade till uppdraget ────────────────
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const boardCanManage = isStaff || ctx.isParticipant;
  const [boardRes, resources] = await Promise.all([
    pb
      .collection('tasks')
      .getList<TaskRow>(1, 200, {
        filter: pb.filter('tenant = {:t} && mission = {:m} && status != "cancelled"', {
          t: user.tenant,
          m: mission.id
        }),
        sort: '-created',
        expand: 'owner,assignees'
      })
      .catch(() => ({ items: [] as TaskRow[] })),
    isStaff ? listAssignableResourcesForTenant(pb, user.tenant) : Promise.resolve([])
  ]);

  const boardTasks: StartupBoardTask[] = boardRes.items
    .filter((t) => isStartupBoardStatus(t.status))
    .map((t) => ({
      id: t.id,
      status: t.status as StartupBoardStatus,
      title: t.description,
      kind: t.kind,
      dueAt: t.due_at || undefined,
      ownerId: t.owner || undefined,
      ownerName: userName(t.expand?.owner) || undefined,
      assignees: (t.expand?.assignees || []).map((a) => ({ id: a.id, name: userName(a) })),
      canEdit: boardCanManage || (!!t.owner && t.owner === user.id)
    }));

  // ── Dokumentation (§ 29): uppladdade filer kopplade till uppdraget ─────
  let documents: MissionDocView[] = [];
  try {
    const docsRes = await pb
      .collection(PB_COLLECTIONS.missionDocuments)
      .getList<MissionDocument>(1, 100, {
        filter: pb.filter('mission = {:m}', { m: mission.id }),
        sort: '-created'
      });
    const base = getPublicPbUrl().replace(/\/$/, '');
    documents = docsRes.items.map((d) => ({
      id: d.id,
      title: d.title || undefined,
      filename: d.filename || 'dokument',
      url: `${base}/api/files/mission_documents/${d.id}/${encodeURIComponent(d.file)}`,
      sizeBytes: d.size_bytes,
      created: d.created
    }));
  } catch {
    /* fail-soft: ej migrerat schema → tom lista */
  }

  // Team-medlemmar med kompetenser (för panelen)
  const usersByIdLabel = new Map(users.map((u) => [u.id, u.label]));
  const teamMembers: TeamMemberView[] = participantsForUi.map((p) => {
    const meta = userMeta.get(p.user_id);
    return {
      id: p.user_id,
      name: usersByIdLabel.get(p.user_id) || p.user_id,
      title: meta?.title,
      role: p.role,
      competences: meta?.competences ?? []
    };
  });

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
          <section>
            <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
              <Icon name="flow" size={15} />
              <h2 className="mx-fw-6 mx-t-15" style={{ margin: 0 }}>
                Tavla
              </h2>
              <span className="mx-mono mx-t-xs mx-muted">
                Teamets gemensamma uppgifter
              </span>
            </div>
            <MissionTaskBoard
              missionId={mission.id}
              tasks={boardTasks}
              resources={resources}
              canManage={boardCanManage}
            />
          </section>
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
          <TeamCompetencePanel members={teamMembers} />
          <MissionDocuments
            missionId={mission.id}
            documents={documents}
            canManage={isStaff}
          />
        </div>
      </div>
    </div>
  );
}
