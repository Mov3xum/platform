import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { phaseLabels, type StartupStatus } from '@/lib/labels';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { StartupCard, type StartupCardData } from '@/components/StartupCard';
import { buildStartupTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUS = new Set<StartupStatus>(['active', 'alumni', 'paused', 'rejected']);

interface StartupRecord {
  id: string;
  name: string;
  description?: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  expand?: { coaches?: { id: string; name: string }[] };
}

function buildFilter(q?: string, phase?: string, status?: string): string | undefined {
  const parts: string[] = [];
  if (q) parts.push(`name ~ "${q.replace(/"/g, '\\"')}"`);
  if (phase && ALL_PHASES.includes(phase as StartupPhase)) parts.push(`phase = "${phase}"`);
  if (status && ALLOWED_STATUS.has(status as StartupStatus)) parts.push(`status = "${status}"`);
  return parts.length > 0 ? parts.join(' && ') : undefined;
}

function toCardData(s: StartupRecord): StartupCardData {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    phase: s.phase,
    status: s.status,
    irl_level: s.irl_level,
    next_step: s.next_step,
    coachNames: (s.expand?.coaches || []).map((c) => c.name).filter(Boolean)
  };
}

export default async function InkubatorPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; phase?: string; status?: string; view?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) redirect('/dashboard');
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const canCreate = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const params = await searchParams;
  const view = params.view === 'list' ? 'list' : 'kanban';
  const hasFilters = Boolean(params.q || params.phase || params.status);

  let items: StartupRecord[] = [];
  let loadFailed = false;
  try {
    const result = await listForTenant<StartupRecord>('startups', {
      filter: buildFilter(params.q, params.phase, params.status),
      sort: 'name',
      perPage: 300,
      expand: 'coaches'
    });
    items = result.items;
  } catch (error) {
    loadFailed = true;
    console.error('[startups] inkubator load failed', { tenant: user.tenant, error });
  }

  const cards = items.map(toCardData);
  const byPhase = new Map<StartupPhase, StartupCardData[]>();
  for (const c of cards) {
    const list = byPhase.get(c.phase) || [];
    list.push(c);
    byPhase.set(c.phase, list);
  }
  // I kanban visar vi alla faser som har bolag, i fas-ordning.
  const phaseColumns = ALL_PHASES.filter((p) => (byPhase.get(p)?.length || 0) > 0);

  const tabs = buildStartupTabs({ isStaff, inflowBadge: 0 });

  const qs = (next: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q: params.q, phase: params.phase, status: params.status, view, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/startups/inkubator?${s}` : '/startups/inkubator';
  };

  const actions = (
    <>
      <div className="hidden items-center gap-1 rounded-lg border border-default bg-surface p-0.5 md:flex">
        <Link
          href={qs({ view: 'kanban' })}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${view === 'kanban' ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:text-foreground'}`}
        >
          Kanban
        </Link>
        <Link
          href={qs({ view: 'list' })}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${view === 'list' ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:text-foreground'}`}
        >
          Lista
        </Link>
      </div>
      {canCreate && (
        <Link
          href="/startups/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
        >
          <Icon name="plus" size={12} /> Nytt bolag
        </Link>
      )}
    </>
  );

  return (
    <PageShell
      title="Startups"
      meta={<span className="text-[12px] text-foreground-subtle">{cards.length} bolag</span>}
      tabs={tabs}
      actions={actions}
    >
      <div className="py-6">
        <form method="get" className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-default bg-surface p-2.5">
          <input type="hidden" name="view" value={view} />
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Sök bolag…"
            className="min-w-[180px] flex-1 rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[13px] text-foreground outline-none transition focus:border-brand"
          />
          <select
            name="phase"
            defaultValue={params.phase ?? ''}
            className="rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[13px] text-foreground"
          >
            <option value="">Alla faser</option>
            {ALL_PHASES.map((p) => (
              <option key={p} value={p}>
                {phaseLabels[p]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg border border-default bg-canvas-muted px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-canvas-subtle"
          >
            Filtrera
          </button>
          {hasFilters && (
            <Link
              href={view === 'list' ? '/startups/inkubator?view=list' : '/startups/inkubator'}
              className="rounded-lg px-3 py-1.5 text-[13px] text-foreground-muted hover:text-foreground"
            >
              Nollställ
            </Link>
          )}
        </form>

        {loadFailed ? (
          <div className="rounded-xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Kunde inte ladda bolagslistan just nu.
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center">
            <h2 className="text-base font-semibold text-foreground">
              {hasFilters ? 'Inga bolag matchar filtret' : 'Inga bolag i inkubatorn än'}
            </h2>
            <p className="mt-2 text-[13px] text-foreground-muted">
              {hasFilters
                ? 'Prova att ta bort filter eller söka på något annat.'
                : 'Konvertera ett lead från inflödet eller skapa ett bolag manuellt.'}
            </p>
          </div>
        ) : view === 'list' ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <StartupCard key={c.id} startup={c} />
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {phaseColumns.map((phase) => {
              const list = byPhase.get(phase) || [];
              return (
                <div key={phase} className="flex w-[300px] shrink-0 flex-col">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {phaseLabels[phase]}
                    </span>
                    <span className="rounded-full bg-canvas-muted px-2 py-0.5 font-mono text-[11px] text-foreground-subtle">
                      {list.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 rounded-2xl bg-canvas-subtle p-2">
                    {list.map((c) => (
                      <StartupCard key={c.id} startup={c} compact />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
