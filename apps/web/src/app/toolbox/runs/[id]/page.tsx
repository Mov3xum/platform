import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { ToolRunStatusBadge } from '@/components/Badges';
import type { ToolRun, ToolRunStatus } from '@platform/shared';

export default async function ToolRunDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'toolbox', user.disabledModules)) notFound();
  const pb = await getServerPb();

  let run: ToolRun;
  try {
    run = await pb.collection('tool_runs').getOne<ToolRun>(id, {
      expand: 'tool,startup,triggered_by'
    });
  } catch {
    notFound();
  }

  if (run.tenant !== user.tenant) notFound();

  const tool = run.expand?.tool;
  const startup = run.expand?.startup;
  const triggeredBy = run.expand?.triggered_by;

  const durationMs =
    run.started_at && run.completed_at
      ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
      : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link
          href={tool ? `/toolbox/${run.tool}` : '/toolbox'}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          ← {tool?.name ?? 'Verktygslådan'}
        </Link>
      </div>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            {tool?.icon && <span className="text-2xl">{tool.icon}</span>}
            <ToolRunStatusBadge status={run.status as ToolRunStatus} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {tool?.name ?? 'Verktygskörning'}
          </h1>
          {startup && (
            <p className="mt-1 text-sm text-foreground-muted">
              Bolag:{' '}
              <Link href={`/startups/${startup.id}`} className="text-link hover:underline">
                {startup.name}
              </Link>
            </p>
          )}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {run.status === 'failed' && run.error && (
            <div className="mb-6 rounded-2xl bg-movexum-pastell-orange px-5 py-4 dark:bg-movexum-morkorange/40">
              <p className="text-sm font-medium text-movexum-morkorange dark:text-movexum-pastell-orange">
                Fel: {run.error}
              </p>
            </div>
          )}

          {run.output_md ? (
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Resultat</h2>
                {(run.tokens_in || run.tokens_out) && (
                  <span className="text-xs text-foreground-subtle">
                    ⚠️ Genererat av AI – verifiera innan delning
                  </span>
                )}
              </div>
              <div className="prose prose-sm max-w-none text-foreground-muted dark:prose-invert">
                <pre className="whitespace-pre-wrap font-body text-sm">{run.output_md}</pre>
              </div>
            </section>
          ) : (
            <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-12 text-center">
              <p className="text-foreground-muted">
                {run.status === 'running' || run.status === 'queued'
                  ? 'Väntar på resultat…'
                  : 'Inget resultat genererat.'}
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-default bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Metadata</h3>
            <dl className="space-y-2 text-xs text-foreground-muted">
              <div>
                <dt className="font-medium">Status</dt>
                <dd><ToolRunStatusBadge status={run.status as ToolRunStatus} /></dd>
              </div>
              <div>
                <dt className="font-medium">Utfört av</dt>
                <dd>{triggeredBy?.display_name ?? triggeredBy?.email ?? 'Okänd'}</dd>
              </div>
              <div>
                <dt className="font-medium">Startad</dt>
                <dd>
                  {run.started_at
                    ? new Date(run.started_at).toLocaleString('sv-SE')
                    : new Date(run.created).toLocaleString('sv-SE')}
                </dd>
              </div>
              {run.completed_at && (
                <div>
                  <dt className="font-medium">Klar</dt>
                  <dd>{new Date(run.completed_at).toLocaleString('sv-SE')}</dd>
                </div>
              )}
              {durationMs !== null && (
                <div>
                  <dt className="font-medium">Tid</dt>
                  <dd>{(durationMs / 1000).toFixed(1)} s</dd>
                </div>
              )}
              {run.model && (
                <div>
                  <dt className="font-medium">Modell</dt>
                  <dd className="font-mono">{run.model}</dd>
                </div>
              )}
              {(run.tokens_in !== undefined && run.tokens_in > 0) && (
                <div>
                  <dt className="font-medium">Tokens in</dt>
                  <dd>{run.tokens_in?.toLocaleString('sv-SE')}</dd>
                </div>
              )}
              {(run.tokens_out !== undefined && run.tokens_out > 0) && (
                <div>
                  <dt className="font-medium">Tokens ut</dt>
                  <dd>{run.tokens_out?.toLocaleString('sv-SE')}</dd>
                </div>
              )}
              {(run.cost_estimate_usd !== undefined && run.cost_estimate_usd > 0) && (
                <div>
                  <dt className="font-medium">Kostnad (est.)</dt>
                  <dd>${run.cost_estimate_usd.toFixed(4)}</dd>
                </div>
              )}
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
