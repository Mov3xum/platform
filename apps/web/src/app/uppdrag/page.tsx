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
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-updated',
      expand: 'issuer,recipients,mentor,startup'
    });
    missions = res.items;
  } catch {
    /* ignore */
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
        <MissionKanban missions={filtered} canCreate={isStaff} />
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
