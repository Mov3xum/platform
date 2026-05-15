import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { StrategyEditor } from './StrategyEditor';
import { QuarterlyRecalibrationButton } from './QuarterlyRecalibrationButton';
import type { Strategy, StrategyRevision } from '@platform/shared';

export default async function StrategyPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'education')) notFound();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  let strategy: Strategy & Record<string, unknown>;
  try {
    strategy = await pb
      .collection(PB_COLLECTIONS.strategies)
      .getOne<Strategy & Record<string, unknown>>(id, {
        expand: 'startup,workshop_assignment,coach_approved_by'
      });
  } catch {
    notFound();
  }

  if (strategy.tenant !== user.tenant) notFound();

  const isLinkedStartup = user.linkedStartups.includes(String(strategy.startup));
  if (!isStaff && !isLinkedStartup) notFound();

  // Revisions (most recent first)
  let revisions: StrategyRevision[] = [];
  try {
    const revResult = await pb
      .collection(PB_COLLECTIONS.strategyRevisions)
      .getList<StrategyRevision>(1, 20, {
        filter: `strategy = "${id}"`,
        sort: '-created'
      });
    revisions = revResult.items;
  } catch {
    revisions = [];
  }

  const startup = strategy.expand?.startup;
  const coachApprovedBy = strategy.expand?.coach_approved_by;

  const bandLabels: Record<string, string> = {
    wait: '⏸ Vänta',
    discovery: '🔍 Discovery-sprint',
    execution: '🚀 Execution'
  };
  const bandColors: Record<string, string> = {
    wait: 'bg-movexum-pastell-gul text-movexum-morkgul ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul dark:ring-movexum-morkgul',
    discovery:
      'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
    execution:
      'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron'
  };

  const band = strategy.recommended_band ?? 'wait';
  const nextRecal = strategy.next_recalibration_at
    ? new Date(strategy.next_recalibration_at).toLocaleDateString('sv-SE')
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Till utbildning
        </Link>
        {startup && (
          <Link
            href={`/startups/${startup.id}`}
            className="text-sm text-link hover:underline"
          >
            {startup.name}
          </Link>
        )}
      </div>

      {/* Header */}
      <header className="mb-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ${bandColors[band] ?? bandColors.wait}`}
          >
            {bandLabels[band] ?? band}
          </span>
          {strategy.status === 'committed' && (
            <span className="inline-flex items-center rounded-full bg-movexum-pastell-gron px-2.5 py-0.5 text-xs font-medium ring-1 ring-movexum-ljusgron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron">
              Committad
            </span>
          )}
          {nextRecal && (
            <span className="text-xs text-foreground-subtle">
              Nästa kalibrering: {nextRecal}
            </span>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Internationaliseringsstrategi
        </h1>
        {startup && (
          <p className="mt-1 text-sm text-foreground-muted">
            {startup.name}
            {strategy.committed_at
              ? ` · Committad ${new Date(strategy.committed_at).toLocaleDateString('sv-SE')}`
              : ''}
          </p>
        )}
        {coachApprovedBy && (
          <p className="mt-1 text-xs text-foreground-subtle">
            Godkänd av coach: {coachApprovedBy.display_name ?? coachApprovedBy.email}
            {strategy.coach_approved_at
              ? ` · ${new Date(strategy.coach_approved_at).toLocaleDateString('sv-SE')}`
              : ''}
          </p>
        )}
      </header>

      <div className="mb-6 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
        <p className="text-xs text-movexum-morkbla dark:text-movexum-pastell-bla">
          Genererat av AI (Mistral / Le Chat, EU-suveränt) – verifiera resonemang innan delning.
          Konfidentiella anteckningar exkluderades ur analysen.
        </p>
      </div>

      {/* Editable strategy sections */}
      <StrategyEditor strategy={strategy} isStaff={isStaff} />

      {/* Quarterly recalibration (staff only) */}
      {isStaff && strategy.status === 'committed' && (
        <div className="mt-6">
          <QuarterlyRecalibrationButton strategyId={id} />
        </div>
      )}

      {/* Revision history */}
      {revisions.length > 0 && (
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="mb-4 text-xl font-semibold text-foreground">Revisionsspår</h2>
          <div className="space-y-4">
            {revisions.map((rev) => (
              <div
                key={rev.id}
                className="rounded-2xl border border-default bg-canvas-subtle/40 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="inline-flex rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-xs font-medium text-movexum-morklila dark:bg-movexum-morklila/30 dark:text-movexum-pastell-lila">
                    {rev.revision_type === 'initial'
                      ? 'Initial'
                      : rev.revision_type === 'quarterly'
                        ? `Kvartal ${rev.quarter_number ?? ''}`
                        : rev.revision_type === 'coach_override'
                          ? 'Coach-override'
                          : 'Manuell'}
                  </span>
                  <span className="text-xs text-foreground-subtle">
                    {new Date(rev.created).toLocaleDateString('sv-SE', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
                <p className="text-sm text-foreground-muted">{rev.change_summary}</p>
                {rev.ai_output && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-link hover:underline">
                      Visa AI-output
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground-subtle">
                      {rev.ai_output}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
