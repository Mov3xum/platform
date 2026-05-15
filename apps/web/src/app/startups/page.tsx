import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { phaseLabels, statusLabels, type StartupStatus } from '@/lib/labels';

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
      sort: '-created',
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Startups</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {result.totalItems} bolag i {user.tenantName || 'din tenant'}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/startups/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Nytt bolag
          </Link>
        )}
      </header>

      <FilterBar current={params} />

      {loadFailed ? (
        <div className="mb-6 rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
          Kunde inte ladda bolagslistan just nu. Forsok igen om en stund.
        </div>
      ) : null}

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
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-default bg-surface p-3"
    >
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Sök bolag…"
        className="min-w-[180px] flex-1 rounded-full border border-default bg-surface px-4 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      <select
        name="phase"
        defaultValue={current.phase ?? ''}
        className="rounded-full border border-default bg-surface px-3 py-2 text-sm text-foreground"
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
        className="rounded-full border border-default bg-surface px-3 py-2 text-sm text-foreground"
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
        className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-hover"
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
      className="group flex flex-col rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground transition group-hover:text-link">
          {startup.name}
        </h2>
      </div>
      {startup.description && (
        <p className="mb-4 line-clamp-3 text-sm text-foreground-muted">{startup.description}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
        <span>Status: {statusLabels[startup.status]}</span>
        <span>•</span>
        <span>Fas: {phaseLabels[startup.phase]}</span>
        {startup.irl_level ? <span>• IRL {startup.irl_level}</span> : null}
      </div>
    </Link>
  );
}

function EmptyState({ canCreate, hasFilters }: { canCreate: boolean; hasFilters: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-12 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        {hasFilters ? 'Inga bolag matchar filtret' : 'Inga bolag än'}
      </h2>
      <p className="mt-2 text-sm text-foreground-muted">
        {hasFilters
          ? 'Prova att ta bort filter eller söka på något annat.'
          : 'Skapa ett första bolag för att komma igång.'}
      </p>
      {canCreate && !hasFilters && (
        <Link
          href="/startups/new"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          + Nytt bolag
        </Link>
      )}
    </div>
  );
}
