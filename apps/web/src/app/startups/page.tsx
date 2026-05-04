import Link from 'next/link';
import { listForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { phaseLabels, statusLabels, type StartupStatus } from '@/lib/labels';
import { PhaseBadge, StatusBadge } from '@/components/Badges';

interface StartupRecord {
  id: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  tags?: string;
}

function buildFilter(search?: string, phase?: string, status?: string): string | undefined {
  const parts: string[] = [];
  if (search) parts.push(`name ~ "${search.replace(/"/g, '\\"')}"`);
  if (phase && ALL_PHASES.includes(phase as StartupPhase)) parts.push(`phase = "${phase}"`);
  if (status) parts.push(`status = "${status}"`);
  return parts.length > 0 ? parts.join(' && ') : undefined;
}

export default async function StartupsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; phase?: string; status?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const canCreate = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  const result = await listForTenant<StartupRecord>('startups', {
    filter: buildFilter(params.q, params.phase, params.status),
    sort: '-created',
    perPage: 100
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Startups</h1>
          <p className="mt-1 text-sm text-slate-600">
            {result.totalItems} bolag i {user.tenantName || 'din tenant'}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/startups/new"
            className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            + Nytt bolag
          </Link>
        )}
      </header>

      <FilterBar current={params} />

      {result.items.length === 0 ? (
        <EmptyState canCreate={canCreate} hasFilters={Boolean(params.q || params.phase || params.status)} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {result.items.map((s) => (
            <StartupCard key={s.id} startup={s} />
          ))}
        </div>
      )}
    </main>
  );
}

function FilterBar({ current }: { current: { q?: string; phase?: string; status?: string } }) {
  return (
    <form
      method="get"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"
    >
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Sök bolag…"
        className="min-w-[180px] flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <select
        name="phase"
        defaultValue={current.phase ?? ''}
        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
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
        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
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
        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
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
      className="group flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-900/5 transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950 group-hover:text-cyan-700">
          {startup.name}
        </h2>
        <StatusBadge status={startup.status} />
      </div>
      {startup.description && (
        <p className="mb-4 line-clamp-3 text-sm text-slate-600">{startup.description}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <PhaseBadge phase={startup.phase} />
        {startup.irl_level ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700">
            IRL {startup.irl_level}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function EmptyState({ canCreate, hasFilters }: { canCreate: boolean; hasFilters: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/50 p-12 text-center">
      <h2 className="text-lg font-semibold text-slate-950">
        {hasFilters ? 'Inga bolag matchar filtret' : 'Inga bolag än'}
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {hasFilters
          ? 'Prova att ta bort filter eller söka på något annat.'
          : 'Skapa ett första bolag för att komma igång.'}
      </p>
      {canCreate && !hasFilters && (
        <Link
          href="/startups/new"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          + Nytt bolag
        </Link>
      )}
    </div>
  );
}
