import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canRunTool } from '@/lib/rbac';
import { ToolRunStatusBadge } from '@/components/Badges';
import { AI_OUTPUT_WARNING_TEXT } from '@/lib/ai/ui-text';
import { isAllowedModel } from '@/lib/ai/models';
import { MessageList, legacyMessagesFromRun } from './MessageList';
import { ContinueChatForm } from './ContinueChatForm';
import type {
  Tool,
  ToolModel,
  ToolRun,
  ToolRunMessage,
  ToolRunStatus
} from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

interface RunWebSource {
  source: string;
  label: string;
  fetched_at: string;
  cached: boolean;
  ok: boolean;
  error?: string;
}

export default async function ToolRunDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'agenter', user.disabledModules)) notFound();
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

  const webSources: RunWebSource[] = Array.isArray(
    (run.input as Record<string, unknown> | undefined)?.web_sources
  )
    ? ((run.input as { web_sources: RunWebSource[] }).web_sources)
    : [];

  // Chatt-läge: bara AI-verktyg får fortsätta. Skribent eller staff,
  // och canRunTool (skydd mot rollnedgradering mid-chat).
  const isAiTool =
    tool?.category === 'ai_per_startup' || tool?.category === 'ai_system_wide';
  const isStaff = hasRole(user.roles, [...STAFF_ROLES]);
  const isAuthor = run.triggered_by === user.id;
  const isLinkedStartup = run.startup
    ? user.linkedStartups.includes(run.startup)
    : false;
  const stillHasRunPermission = tool
    ? canRunTool(user.roles, tool as Tool, { isLinkedStartup })
    : false;
  let canContinue = false;
  let disabledReason: string | undefined;
  if (!isAiTool) {
    disabledReason = 'Detta är inte ett AI-verktyg.';
  } else if (!isAuthor && !isStaff) {
    disabledReason = 'Endast den som startade chatten — eller staff — kan fortsätta.';
  } else if (!stillHasRunPermission) {
    disabledReason = 'Du har inte längre behörighet att köra denna agent.';
  } else if (run.status === 'failed') {
    disabledReason = 'Den här körningen misslyckades.';
  } else {
    canContinue = true;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link
          href={tool ? `/toolbox/${run.tool}` : '/toolbox'}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          ← {tool?.name ?? 'AI-agenter'}
        </Link>
      </div>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            {tool?.icon && <span className="text-2xl">{tool.icon}</span>}
            <ToolRunStatusBadge status={run.status as ToolRunStatus} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {tool?.name ?? 'Agentkörning'}
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

          {webSources.length > 0 && (
            <section className="mb-6 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Källor (live)</h2>
              <ul className="space-y-2 text-xs text-foreground-muted">
                {webSources.map((s) => (
                  <li key={`${s.source}-${s.fetched_at}`} className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {s.label}
                      {s.cached && (
                        <span className="ml-2 text-foreground-subtle">(cache)</span>
                      )}
                      {!s.ok && (
                        <span className="ml-2 text-movexum-morkorange dark:text-movexum-pastell-orange">
                          – {s.error || 'kunde inte hämtas'}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-foreground-subtle">
                      {new Date(s.fetched_at).toLocaleString('sv-SE')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-foreground-subtle">
                Live-källor är EU-baserade och cachas i 30 min för att inte överbelasta källorna.
              </p>
            </section>
          )}

          {run.output_md || (run.messages && run.messages.length > 0) ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Chatt</h2>
                <span className="text-xs text-foreground-subtle">
                  ⚠️ {AI_OUTPUT_WARNING_TEXT}
                </span>
              </div>

              <MessageList
                messages={
                  run.messages && run.messages.length > 0
                    ? (run.messages as ToolRunMessage[])
                    : legacyMessagesFromRun(run)
                }
              />

              {isAiTool && (
                <ContinueChatForm
                  runId={run.id}
                  defaultModel={
                    isAllowedModel(run.model)
                      ? (run.model as ToolModel)
                      : isAllowedModel(tool?.model)
                        ? (tool!.model as ToolModel)
                        : undefined
                  }
                  disabled={!canContinue}
                  disabledReason={disabledReason}
                />
              )}
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
