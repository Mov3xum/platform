// Movexum OS — Uppdrag & flöden (lista + flöde / kanban)

import Link from 'next/link';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
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

  const filtered = missions.filter((m) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return m.status !== 'done' && m.status !== 'archived';
    return m.status === statusFilter;
  });

  const selectedId = sp.m && filtered.find((m) => m.id === sp.m) ? sp.m : filtered[0]?.id;
  const selected = filtered.find((m) => m.id === selectedId) || null;

  const byStatus = missions.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Totalt" value={missions.length} />
          <RailStat label="I urval" value={filtered.length} />
        </div>
      </RailSection>

      <RailSection label="Per status">
        {(Object.keys(STATUS_LABELS) as MissionStatus[]).map((s) => (
          <div
            key={s}
            className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px]"
          >
            <span className="text-foreground">{STATUS_LABELS[s]}</span>
            <span className="font-mono text-[11px] text-foreground-subtle">
              {byStatus[s] || 0}
            </span>
          </div>
        ))}
      </RailSection>
    </>
  );

  const actions = (
    <>
      <div className="flex items-center rounded-lg border border-default bg-surface p-0.5">
        <Link
          href={{ pathname: '/uppdrag', query: { ...sp, view: 'flow' } }}
          className={`rounded-md px-3 py-1 text-[12px] font-medium transition ${
            view === 'flow'
              ? 'bg-canvas-muted text-foreground'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          Flöde
        </Link>
        <Link
          href={{ pathname: '/uppdrag', query: { ...sp, view: 'board' } }}
          className={`rounded-md px-3 py-1 text-[12px] font-medium transition ${
            view === 'board'
              ? 'bg-canvas-muted text-foreground'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          Kanban
        </Link>
      </div>
      {isStaff && (
        <Link
          href="/uppdrag/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
        >
          <Icon name="plus" size={12} /> Nytt uppdrag
        </Link>
      )}
    </>
  );

  return (
    <PageShell title="Uppdrag & flöden" actions={actions} rightPanel={rail}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const active = statusFilter === opt.key;
            return (
              <Link
                key={opt.key}
                href={{ pathname: '/uppdrag', query: { ...sp, status: opt.key, m: undefined } }}
                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[12px] font-medium transition ${
                  active
                    ? 'border-default bg-canvas-muted text-foreground'
                    : 'border-default bg-surface text-foreground-muted hover:border-strong hover:text-foreground'
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>

        {view === 'flow' ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
            <MissionList missions={filtered} selectedId={selectedId || ''} />
            {selected ? (
              <MissionFlow
                mission={selected}
                currentUserId={user.id}
                canAdvance={isStaff || selected.recipients.includes(user.id)}
              />
            ) : (
              <div className="rounded-2xl border border-default bg-surface p-6 text-[13px] text-foreground-muted">
                Välj ett uppdrag i listan.
              </div>
            )}
          </div>
        ) : (
          <MissionKanban missions={filtered} canCreate={isStaff} />
        )}
      </div>
    </PageShell>
  );
}
