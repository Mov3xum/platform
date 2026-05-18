import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { Icon } from '@/components/proto/Icon';
import DashboardChat from '@/components/DashboardChat';

interface ToolRow {
  id: string;
  name: string;
  category: string;
  description?: string;
}

interface RunRow {
  id: string;
  tool: string;
  created: string;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 10) return 'God morgon';
  if (h < 13) return 'God förmiddag';
  if (h < 17) return 'God eftermiddag';
  return 'God kväll';
}

export default async function IdagPage() {
  const user = await requireUser();

  // Founders har en egen inkorg som sin "Idag"
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  if (!isStaff && hasRole(user.roles, ['startup_member'])) {
    redirect('/inkorg');
  }

  const pb = await getServerPb();

  const [toolsRes, runsRes] = await Promise.allSettled([
    pb.collection('tools').getList<ToolRow>(1, 50, {
      filter: pb.filter('tenant = {:tenant} && active = true', { tenant: user.tenant }),
      sort: 'name'
    }),
    pb.collection('tool_runs').getList<RunRow>(1, 200, {
      filter: pb.filter('tenant = {:tenant} && triggered_by = {:userId}', {
        tenant: user.tenant,
        userId: user.id
      }),
      sort: '-created',
      fields: 'id,tool,created'
    })
  ]);

  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const runs = runsRes.status === 'fulfilled' ? runsRes.value.items : [];

  // Räkna körningar per verktyg och välj mina mest använda
  const runCount = new Map<string, { count: number; last: string }>();
  for (const r of runs) {
    const e = runCount.get(r.tool) || { count: 0, last: r.created };
    e.count++;
    if (r.created > e.last) e.last = r.created;
    runCount.set(r.tool, e);
  }

  const myAssistants = tools
    .filter((t) => t.category === 'ai_per_startup' || t.category === 'ai_system_wide')
    .map((t) => ({ ...t, runs: runCount.get(t.id)?.count || 0 }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6);

  const firstName = user.name.split(' ')[0] || user.email;

  return (
    <div className="mx-view-pad mx-narrow flex h-full flex-col">
      <div className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          Idag
        </div>
        <h1 className="mt-1 font-heading text-[32px] font-semibold tracking-tight text-foreground lg:text-[40px]">
          {greeting()}, {firstName}.
        </h1>
        <p className="mt-2 max-w-[60ch] text-[14px] text-foreground-muted">
          Ställ en fråga om portföljen, eller starta en av dina sparade assistenter. Välj ett bolag i
          railen till vänster för att gå djupare.
        </p>
      </div>

      {/* Chat-ruta — huvudvyn */}
      <div className="flex-1 min-h-0">
        <DashboardChat className="h-full" />
      </div>

      {/* Sparade assistenter */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
              Dina assistenter
            </div>
            <h2 className="mt-1 font-heading text-[18px] font-semibold text-foreground">
              Snabbstart
            </h2>
          </div>
          <Link
            href="/toolbox"
            className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] text-foreground-muted hover:bg-canvas-muted"
          >
            Alla verktyg <Icon name="chevron" size={12} />
          </Link>
        </div>

        {myAssistants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-8 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
              <Icon name="sparkle" size={18} />
            </div>
            <p className="text-[13px] text-foreground-subtle">
              Inga AI-assistenter aktiverade ännu.{' '}
              <Link href="/toolbox" className="text-brand underline">
                Skapa eller aktivera verktyg
              </Link>{' '}
              i verktygslådan.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myAssistants.map((a) => (
              <Link
                key={a.id}
                href={`/toolbox/${a.id}`}
                className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                    <Icon name="sparkle" size={16} />
                  </div>
                  <span className="font-mono text-[10.5px] text-foreground-subtle">
                    {a.runs} körningar
                  </span>
                </div>
                <h3 className="font-heading text-[14px] font-semibold text-foreground">{a.name}</h3>
                {a.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-foreground-muted">
                    {a.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
