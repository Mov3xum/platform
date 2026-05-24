import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase, type SprintXScore } from '@platform/shared';
import { phaseLabels, statusLabels, type StartupStatus } from '@/lib/labels';
import { StartupListDashboard } from '@/components/StartupListDashboard';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { Icon } from '@/components/proto';

interface StartupRecord {
  id: string;
  tenant: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  tags?: string;
  sprint_x_json?: SprintXScore;
  coaches?: string[];
}

const ALLOWED_STATUS = new Set(Object.keys(statusLabels));

function buildFilter(search?: string, phase?: string, status?: string): string | undefined {
  const parts: string[] = [];
  if (search) parts.push(`name ~ "${search.replace(/"/g, '\\"')}"`);
  if (phase && ALL_PHASES.includes(phase as StartupPhase)) parts.push(`phase = "${phase}"`);
  if (status && ALLOWED_STATUS.has(status)) parts.push(`status = "${status}"`);
  return parts.length > 0 ? parts.join(' && ') : undefined;
}

export default async function StartupsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; phase?: string; status?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) redirect('/dashboard');
  const params = await searchParams;
  const canCreate = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  let result: { items: StartupRecord[]; totalItems: number } = { items: [], totalItems: 0 };
  let loadFailed = false;

  try {
    result = await listForTenant<StartupRecord>('startups', {
      filter: buildFilter(params.q, params.phase, params.status),
      sort: 'name',
      perPage: 100
    });
  } catch (error) {
    loadFailed = true;
    console.error('[startups] failed to load startup list', {
      tenant: user.tenant,
      userId: user.id,
      params,
      error
    });
  }

  const irlSamples = result.items.filter((s) => s.irl_level);
  const avgIRL = irlSamples.length
    ? irlSamples.reduce((sum, s) => sum + (s.irl_level || 0), 0) / irlSamples.length
    : 0;

  const sxAvg = (key: keyof SprintXScore) => {
    const list = result.items.filter((s) => s.sprint_x_json?.[key]);
    return list.length
      ? list.reduce((sum, s) => sum + (s.sprint_x_json?.[key] || 0), 0) / list.length
      : 0;
  };

  const metrics = {
    totalStartups: result.totalItems,
    activeStartups: result.items.filter((s) => s.status === 'active').length,
    byPhase: result.items.reduce(
      (acc, s) => {
        acc[s.phase] = (acc[s.phase] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    byStatus: result.items.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    avgIRLLevel: avgIRL,
    avgSprintX: {
      funding: sxAvg('funding'),
      intl: sxAvg('intl'),
      sustain: sxAvg('sustain'),
      team: sxAvg('team')
    }
  };

  const rail = (
    <>
      <RailSection label="Bolag">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Totalt" value={result.totalItems} />
          <RailStat label="Aktiva" value={metrics.activeStartups} />
          <RailStat label="∅ IRL" value={avgIRL ? avgIRL.toFixed(1) : '—'} />
          <RailStat label="Faser" value={Object.keys(metrics.byPhase).length} />
        </div>
      </RailSection>

      <RailSection label="Per fas">
        {ALL_PHASES.filter((p) => metrics.byPhase[p]).map((p) => (
          <Link
            key={p}
            href={`/startups?phase=${p}`}
            className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-foreground-muted hover:bg-canvas-muted hover:text-foreground"
          >
            {phaseLabels[p]}
            <span className="font-mono text-[11px] text-foreground-subtle">
              {metrics.byPhase[p]}
            </span>
          </Link>
        ))}
      </RailSection>
    </>
  );

  const actions = canCreate ? (
    <Link
      href="/startups/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Nytt bolag
    </Link>
  ) : null;

  return (
    <PageShell
      title="Bolag"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {result.totalItems} i {user.tenantName || 'tenanten'}
        </span>
      }
      actions={actions}
      rightPanel={rail}
    >
      <div className="py-6">
        {!loadFailed && result.items.length > 0 && (
          <StartupListDashboard startups={result.items} metrics={metrics} />
        )}

        <FilterBar current={params} />

        {loadFailed ? (
          <div className="rounded-xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Kunde inte ladda bolagslistan just nu. Försök igen om en stund.
          </div>
        ) : null}

        {result.items.length === 0 ? (
          <EmptyState
            canCreate={canCreate}
            hasFilters={Boolean(params.q || params.phase || params.status)}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.items.map((s) => (
              <StartupCard key={s.id} startup={s} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function FilterBar({ current }: { current: { q?: string; phase?: string; status?: string } }) {
  return (
    <form
      method="get"
      className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-default bg-surface p-2.5"
    >
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Sök bolag…"
        className="min-w-[180px] flex-1 rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[13px] text-foreground outline-none transition focus:border-brand"
      />
      <select
        name="phase"
        defaultValue={current.phase ?? ''}
        className="rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[13px] text-foreground"
      >
        <option value="">Alla faser</option>
        {ALL_PHASES.map((p) => (
          <option key={p} value={p}>
            {phaseLabels[p]}
          </option>
        ))}
      </select>
      <select
        name="status"
        defaultValue={current.status ?? ''}
        className="rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[13px] text-foreground"
      >
        <option value="">Alla statusar</option>
        {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((s) => (
          <option key={s} value={s}>
            {statusLabels[s]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-default bg-canvas-muted px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-canvas-subtle"
      >
        Filtrera
      </button>
    </form>
  );
}

function StartupCard({ startup }: { startup: StartupRecord }) {
  return (
    <Link
      href={`/startups/${startup.id}`}
      className="group flex flex-col rounded-2xl border border-default bg-surface p-5 transition hover:border-strong"
    >
      <h2 className="mb-2 text-[15px] font-semibold text-foreground transition group-hover:text-link">
        {startup.name}
      </h2>
      {startup.description && (
        <p className="mb-4 line-clamp-3 text-[13px] text-foreground-muted">
          {startup.description}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-foreground-subtle">
        <span>{statusLabels[startup.status]}</span>
        <span>·</span>
        <span>{phaseLabels[startup.phase]}</span>
        {startup.irl_level ? (
          <>
            <span>·</span>
            <span className="font-mono">IRL {startup.irl_level}</span>
          </>
        ) : null}
      </div>
    </Link>
  );
}

function EmptyState({ canCreate, hasFilters }: { canCreate: boolean; hasFilters: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-default p-12 text-center">
      <h2 className="text-base font-semibold text-foreground">
        {hasFilters ? 'Inga bolag matchar filtret' : 'Inga bolag än'}
      </h2>
      <p className="mt-2 text-[13px] text-foreground-muted">
        {hasFilters
          ? 'Prova att ta bort filter eller söka på något annat.'
          : 'Skapa ett första bolag för att komma igång.'}
      </p>
      {canCreate && !hasFilters && (
        <Link
          href="/startups/new"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover"
        >
          + Nytt bolag
        </Link>
      )}
    </div>
  );
}
