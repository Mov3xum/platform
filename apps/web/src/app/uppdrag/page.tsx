// Movexum OS — Uppdrag & flöden (lista + flöde / kanban)
// Server-komponent. Vy och statusfilter styrs via query-parametrar.

import Link from 'next/link';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Chip, Icon } from '@/components/proto';
import { MissionList } from '@/components/MissionList';
import { MissionFlow } from '@/components/MissionFlow';
import { MissionKanban } from '@/components/MissionKanban';
import type { Mission, MissionStatus } from '@platform/shared';

const STATUS_LABELS: Record<MissionStatus, string> = {
  draft: 'Utkast',
  preparation: 'Förberedelse',
  in_progress: 'Pågående',
  review: 'Granskning',
  done: 'Klart',
  archived: 'Arkiverat'
};

const FILTER_OPTIONS: Array<{ key: 'all' | 'open' | MissionStatus; label: string }> = [
  { key: 'all', label: 'Alla' },
  { key: 'open', label: 'Öppna' },
  { key: 'preparation', label: 'Förberedelse' },
  { key: 'in_progress', label: 'Pågående' },
  { key: 'review', label: 'Granskning' },
  { key: 'done', label: 'Klart' }
];

function demoMissions(tenant: string, userId: string): Mission[] {
  const today = new Date();
  const inDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString();
  };
  return [
    {
      id: 'demo_m1',
      tenant,
      title: 'Klimatkompass · Q2-uppföljning',
      type: 'workshop',
      status: 'in_progress',
      issuer: userId,
      recipients: [userId],
      mentor: undefined,
      startup: undefined,
      due_date: inDays(7),
      description: 'Genomför kompassmöte och dokumentera insikter.',
      accent: 'purple',
      stages_json: [
        { id: 'assigned', label: 'Tilldelat', done: true, time: '2026-05-08 09:14' },
        { id: 'received', label: 'Mottaget', done: true, time: '2026-05-09 10:02' },
        { id: 'in_progress', label: 'Utförs', done: false },
        { id: 'submission', label: 'Inlämning', done: false }
      ],
      artifacts_json: [
        { id: 'a1', name: 'Klimatkompass-mall.pdf', size: '420 KB', created: inDays(-2) }
      ],
      created: inDays(-7),
      updated: inDays(-1),
      expand: {
        issuer: { id: userId, display_name: 'Demo Issuer', email: 'demo@movexum.se' }
      }
    },
    {
      id: 'demo_m2',
      tenant,
      title: 'Sprint X · självskattning juni',
      type: 'sprint_x',
      status: 'preparation',
      issuer: userId,
      recipients: [userId],
      due_date: inDays(14),
      description: 'Kvartalsvis Sprint X-checkin.',
      accent: 'copper',
      stages_json: [
        { id: 'assigned', label: 'Tilldelat', done: true, time: '2026-05-10 14:00' },
        { id: 'self_assessment', label: 'Självskattning', done: false },
        { id: 'review', label: 'Coach-granskning', done: false },
        { id: 'commit', label: 'Commit', done: false }
      ],
      artifacts_json: [],
      created: inDays(-3),
      updated: inDays(-1),
      expand: {
        issuer: { id: userId, display_name: 'Demo Issuer', email: 'demo@movexum.se' }
      }
    },
    {
      id: 'demo_m3',
      tenant,
      title: 'Onboarding · Narva Health',
      type: 'onboarding',
      status: 'draft',
      issuer: userId,
      recipients: [],
      due_date: inDays(21),
      description: 'Kickoff och första uppdrag för nytt bolag.',
      accent: 'brown',
      stages_json: [
        { id: 'kickoff', label: 'Kickoff', done: false },
        { id: 'profile', label: 'Profil ifylld', done: false },
        { id: 'first_mission', label: 'Första uppdrag', done: false }
      ],
      artifacts_json: [],
      created: inDays(-1),
      updated: inDays(-1),
      expand: {
        issuer: { id: userId, display_name: 'Demo Issuer', email: 'demo@movexum.se' }
      }
    }
  ];
}

type SearchParams = { view?: string; status?: string; m?: string };

export default async function UppdragPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: 'flow' | 'board' = sp.view === 'board' ? 'board' : 'flow';
  const statusFilter = (sp.status as 'all' | 'open' | MissionStatus | undefined) || 'all';
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  const pb = await getServerPb();
  let missions: Mission[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.missions).getList<Mission>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-updated',
      expand: 'issuer,recipients,mentor,startup'
    });
    missions = res.items;
  } catch {
    /* ignore — fall back to demo */
  }

  // Mock-fallback so empty-state isn't broken
  if (missions.length === 0) {
    missions = demoMissions(user.tenant, user.id);
  }

  // Apply status filter
  const filtered = missions.filter((m) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return m.status !== 'done' && m.status !== 'archived';
    return m.status === statusFilter;
  });

  const selectedId = sp.m && filtered.find((m) => m.id === sp.m) ? sp.m : filtered[0]?.id;
  const selected = filtered.find((m) => m.id === selectedId) || null;

  return (
    <div
      className="mx-view-pad mx-wide"
      style={{
        padding: '20px 24px 0',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 16,
        minHeight: 'calc(100vh - 56px)'
      }}
    >
      <PageHead
        crumb="Hemmaplan / Uppdrag & flöden"
        title="Uppdrag & flöden"
        subtitle="Tilldela, följ och dokumentera uppdrag mellan Movexum, startups, partners och community."
        actions={
          <>
            <div
              className="mx-flex"
              style={{
                background: 'var(--mx-paper)',
                border: '1px solid var(--mx-line)',
                borderRadius: 8,
                padding: 2
              }}
            >
              <Link
                href={{ pathname: '/uppdrag', query: { ...sp, view: 'flow' } }}
                className={`mx-btn mx-sm ${view === 'flow' ? 'mx-primary' : 'mx-ghost'}`}
              >
                Flödesvy
              </Link>
              <Link
                href={{ pathname: '/uppdrag', query: { ...sp, view: 'board' } }}
                className={`mx-btn mx-sm ${view === 'board' ? 'mx-primary' : 'mx-ghost'}`}
              >
                Kanban
              </Link>
            </div>
            {isStaff && (
              <Link href="/uppdrag/new" className="mx-btn mx-primary">
                <Icon name="plus" size={13} /> Nytt uppdrag
              </Link>
            )}
          </>
        }
      />

      {/* Status-filterchipar */}
      <div className="mx-flex mx-gap-2 mx-wrap" style={{ alignItems: 'center' }}>
        <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">Filter</span>
        {FILTER_OPTIONS.map((opt) => {
          const isActive = statusFilter === opt.key;
          return (
            <Link
              key={opt.key}
              href={{ pathname: '/uppdrag', query: { ...sp, status: opt.key, m: undefined } }}
              style={{ textDecoration: 'none' }}
            >
              <Chip variant={isActive ? 'ink-chip' : 'default'} mono>
                {opt.label}
              </Chip>
            </Link>
          );
        })}
        <span className="mx-grow" />
        <span className="mx-mono mx-t-xs mx-muted">
          {filtered.length} av {missions.length} uppdrag
        </span>
      </div>

      {view === 'flow' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '360px 1fr',
            gap: 16,
            minHeight: 0
          }}
        >
          <MissionList missions={filtered} selectedId={selectedId || ''} />
          {selected ? (
            <MissionFlow
              mission={selected}
              currentUserId={user.id}
              canAdvance={isStaff || selected.recipients.includes(user.id)}
            />
          ) : (
            <div className="mx-card" style={{ padding: 24 }}>
              <div className="mx-muted mx-t-13">Välj ett uppdrag i listan.</div>
            </div>
          )}
        </div>
      ) : (
        <MissionKanban missions={filtered} />
      )}

      <div className="mx-action-bar" style={{ marginLeft: -24, marginRight: -24 }}>
        <span className="mx-save-indicator">
          <span className="mx-dot" /> Live-uppdaterad lista
        </span>
        <span className="mx-mono mx-t-xs mx-muted mx-t-up">
          {missions.length} totalt · {STATUS_LABELS[(selected?.status as MissionStatus) || 'draft']}
        </span>
        <span style={{ flex: 1 }} />
        {isStaff && (
          <Link href="/uppdrag/new" className="mx-btn mx-primary mx-sm">
            <Icon name="plus" size={12} /> Skapa uppdrag
          </Link>
        )}
      </div>
    </div>
  );
}
