import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canRunTool } from '@/lib/rbac';
import { ToolCategoryBadge, ToolRunStatusBadge } from '@/components/Badges';
import { toolCategoryLabels, type ToolRunStatus } from '@/lib/labels';
import { AI_OUTPUT_WARNING_TEXT } from '@/lib/ai/ui-text';
import { getWebSourceLabel } from '@/lib/ai/web';
import { markdownToHtml } from '@/lib/safe-html';
import { RunToolForm } from '../RunToolForm';
import { ScheduleEditor } from '@/components/ScheduleEditor';
import type { Tool, ToolModel, ToolRun, WebSourceKey } from '@platform/shared';
import { isAllowedModel } from '@/lib/ai/models';

export default async function ToolDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ startup?: string }>;
}) {
  const { id } = await params;
  const { startup: defaultStartupId } = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'agenter', user.disabledModules)) notFound();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);

  let tool: Tool;
  try {
    tool = await pb.collection('tools').getOne<Tool>(id);
  } catch {
    notFound();
  }

  if (tool.tenant !== user.tenant) notFound();

  // Check can run (without startup context yet — startup_member gate applied in action)
  const canRun = canRunTool(user.roles, tool, {
    isLinkedStartup: defaultStartupId ? user.linkedStartups.includes(defaultStartupId) : false
  });

  // Load startups for the selector
  let startups: Array<{ id: string; name: string }> = [];
  let startupsLoadFailed = false;
  if (tool.requires_startup) {
    try {
      const result = await pb.collection('startups').getList<{ id: string; name: string }>(1, 200, {
        filter: `tenant = "${user.tenant}" && status = "active"`,
        sort: 'name',
        fields: 'id,name'
      });
      startups = result.items;

      // startup_member: only linked startups
      if (hasRole(user.roles, ['startup_member']) && !isStaff) {
        startups = startups.filter((s) => user.linkedStartups.includes(s.id));
      }
    } catch (error) {
      startupsLoadFailed = true;
      console.error('[toolbox/detail] failed to load startups selector', {
        tenant: user.tenant,
        userId: user.id,
        toolId: id,
        error
      });
    }
  }

  // Recent runs for this tool
  let runsResult: { items: ToolRun[] } = { items: [] };
  let runsLoadFailed = false;
  try {
    runsResult = await pb.collection('tool_runs').getList<ToolRun>(1, 10, {
      filter: `tool = "${id}" && tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'startup,triggered_by'
    });
  } catch (error) {
    runsLoadFailed = true;
    console.error('[toolbox/detail] failed to load recent runs', {
      tenant: user.tenant,
      userId: user.id,
      toolId: id,
      error
    });
  }

  // Schemaläggning — bara staff får se & hantera. Endast tillgängligt för
  // AI-verktyg som inte kräver ett valt bolag (portfölj-agenter).
  const isAiTool =
    tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';
  const canSchedule =
    isStaff &&
    isAiTool &&
    !tool.requires_startup &&
    Boolean(tool.prompt_template) &&
    Boolean(tool.model);

  let existingSchedule:
    | {
        id: string;
        enabled: boolean;
        cron_expression: string;
        timezone?: string;
        next_run_at?: string;
        last_run_at?: string;
      }
    | null = null;
  if (canSchedule) {
    try {
      const rec = await pb
        .collection('tool_schedules')
        .getFirstListItem(`tool = "${id}" && tenant = "${user.tenant}"`);
      existingSchedule = {
        id: rec.id as string,
        enabled: Boolean(rec.enabled),
        cron_expression: (rec.cron_expression as string) || '',
        timezone: (rec.timezone as string) || undefined,
        next_run_at: (rec.next_run_at as string) || undefined,
        last_run_at: (rec.last_run_at as string) || undefined
      };
    } catch {
      /* no schedule yet — keep null */
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/toolbox" className="text-sm text-foreground-muted hover:text-foreground">
          ← AI-agenter
        </Link>
      </div>

      <header className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {tool.icon && <span className="text-3xl">{tool.icon}</span>}
          <ToolCategoryBadge category={tool.category} />
          {!tool.active && (
            <span className="rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-subtle ring-1 ring-default">
              Inaktivt
            </span>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{tool.name}</h1>
        {tool.description && (
          <div
            className="prose prose-sm mt-3 max-w-none text-foreground-muted dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(tool.description) }}
          />
        )}
        {tool.model && (
          <p className="mt-2 text-xs text-foreground-subtle">
            Modell: <span className="font-mono">{tool.model}</span>
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Run form */}
          {canRun ? (
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Kör agent</h2>
              {startupsLoadFailed && tool.requires_startup ? (
                <div className="mb-4 rounded-2xl border border-default bg-surface p-3 text-xs text-foreground-muted">
                  Kunde inte ladda bolagslistan for val just nu.
                </div>
              ) : null}
                <div className="mb-4 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
                  <p className="text-xs text-movexum-morkbla dark:text-movexum-pastell-bla">
                    ⚠️ {AI_OUTPUT_WARNING_TEXT}. Konfidentiella anteckningar exkluderas automatiskt.
                  </p>
                  {Array.isArray(tool.web_sources) && tool.web_sources.length > 0 && (
                    <p className="mt-2 text-xs text-movexum-morkbla dark:text-movexum-pastell-bla">
                      📡 Hämtar live från:{' '}
                      <span className="font-medium">
                        {(tool.web_sources as WebSourceKey[])
                          .map((k) => getWebSourceLabel(k))
                          .join(', ')}
                      </span>
                    </p>
                  )}
                </div>
              <RunToolForm
                toolId={id}
                requiresStartup={tool.requires_startup}
                isAiTool={tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide'}
                startups={startups}
                defaultStartupId={defaultStartupId}
                defaultModel={isAllowedModel(tool.model) ? (tool.model as ToolModel) : undefined}
              />
            </section>
          ) : (
            <div className="rounded-3xl border border-default bg-surface p-6">
              <p className="text-sm text-foreground-muted">
                Du har inte behörighet att köra denna agent.
              </p>
            </div>
          )}

          {/* Schemaläggning — bara staff och bara för portfölj-agenter */}
          {canSchedule && (
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">Schemaläggning</h2>
                <span className="text-xs text-foreground-subtle">
                  Kör verktyget automatiskt enligt valt intervall.
                </span>
              </div>
              <ScheduleEditor
                toolId={id}
                scheduleId={existingSchedule?.id}
                enabled={existingSchedule?.enabled ?? false}
                cronExpression={existingSchedule?.cron_expression ?? '0 7 * * *'}
                timezone={existingSchedule?.timezone ?? 'Europe/Stockholm'}
                lastRunAt={existingSchedule?.last_run_at}
                nextRunAt={existingSchedule?.next_run_at}
              />
            </section>
          )}

          {/* Recent runs */}
          {runsLoadFailed && (
            <div className="rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
              Kunde inte ladda senaste körningar just nu.
            </div>
          )}
          {runsResult.items.length > 0 && (
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Senaste körningar</h2>
              <ul className="space-y-3">
                {runsResult.items.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`/toolbox/runs/${run.id}`}
                      className="flex items-center justify-between rounded-2xl border border-default p-4 transition hover:bg-canvas-subtle"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {(run.expand as any)?.startup?.name ?? 'Portfölj'}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {new Date(run.created).toLocaleString('sv-SE')} ·{' '}
                          {(run.expand as any)?.triggered_by?.display_name ??
                            (run.expand as any)?.triggered_by?.email ??
                            'Okänd'}
                        </p>
                      </div>
                      <ToolRunStatusBadge status={run.status as ToolRunStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {isStaff && (
            <Link
              href={`/toolbox/${id}/edit`}
              className="block rounded-2xl border border-default bg-surface p-4 text-center text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              ✏️ Redigera agent
            </Link>
          )}

          <div className="rounded-2xl border border-default bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Information</h3>
            <dl className="space-y-2 text-xs text-foreground-muted">
              <div>
                <dt className="font-medium">Kategori</dt>
                <dd>{toolCategoryLabels[tool.category]}</dd>
              </div>
              <div>
                <dt className="font-medium">Kräver bolag</dt>
                <dd>{tool.requires_startup ? 'Ja' : 'Nej'}</dd>
              </div>
              {tool.output_format && (
                <div>
                  <dt className="font-medium">Utdataformat</dt>
                  <dd className="font-mono">{tool.output_format}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium">Roller</dt>
                <dd>{tool.roles_allowed?.join(', ') || 'Alla'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
