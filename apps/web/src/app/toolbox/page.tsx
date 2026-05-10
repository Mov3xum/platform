import Link from 'next/link';
import { listForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { hasRole, canRunTool } from '@/lib/rbac';
import { ToolCategoryBadge } from '@/components/Badges';
import { toolCategoryLabels, type ToolCategory } from '@/lib/labels';
import type { Tool } from '@platform/shared';

const CATEGORIES: ToolCategory[] = [
  'ai_per_startup',
  'ai_system_wide',
  'education',
  'template',
  'checklist'
];

export default async function ToolboxPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);

  let result: { items: Tool[] } = { items: [] };
  let loadFailed = false;
  try {
    result = await listForTenant<Tool>('tools', {
      filter: 'active = true',
      sort: 'category,name',
      perPage: 200
    });
  } catch (error) {
    loadFailed = true;
    console.error('[toolbox] failed to load tools', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const visibleTools = result.items.filter((tool) =>
    canRunTool(user.roles, tool, { isLinkedStartup: false })
  );

  const byCategory = CATEGORIES.reduce<Record<ToolCategory, Tool[]>>(
    (acc, cat) => {
      acc[cat] = visibleTools.filter((t) => t.category === cat);
      return acc;
    },
    {} as Record<ToolCategory, Tool[]>
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Verktygslåda</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {visibleTools.length} tillgängliga verktyg
          </p>
        </div>
        {isStaff && (
          <Link
            href="/toolbox/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Nytt verktyg
          </Link>
        )}
      </header>

      {/* AI-sovereignty banner */}
      <div className="mb-8 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-5 py-4 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
        <p className="text-sm text-movexum-morkbla dark:text-movexum-pastell-bla">
          <span className="font-semibold">🔒 AI-verktyg</span> drivs av{' '}
          <span className="font-semibold">Mistral / Le Chat</span> (Frankrike, EU-suveränt).
          Konfidentiella anteckningar exkluderas alltid. Granska alltid AI-genererat material
          innan det delas.
        </p>
      </div>

      <div className="space-y-10">
        {loadFailed && (
          <div className="rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
            Verktygslistan kunde inte laddas just nu. Forsok igen om en stund.
          </div>
        )}

        {CATEGORIES.map((category) => {
          const tools = byCategory[category];
          if (tools.length === 0) return null;
          return (
            <section key={category}>
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                {toolCategoryLabels[category]}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          );
        })}

        {visibleTools.length === 0 && (
          <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-12 text-center">
            <p className="text-foreground-muted">Inga tillgängliga verktyg.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link
      href={`/toolbox/${tool.id}`}
      className="group flex flex-col rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {tool.icon && <span className="text-2xl">{tool.icon}</span>}
          <h3 className="text-base font-semibold text-foreground transition group-hover:text-brand">
            {tool.name}
          </h3>
        </div>
        <ToolCategoryBadge category={tool.category} />
      </div>
      {tool.description && (
        <p
          className="line-clamp-2 text-sm text-foreground-muted"
          dangerouslySetInnerHTML={{ __html: tool.description }}
        />
      )}
      <span className="mt-4 text-xs font-medium text-brand transition group-hover:underline">
        Öppna →
      </span>
    </Link>
  );
}
