import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import DashboardChat from '@/components/DashboardChat';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailEmpty } from '@/components/PageRail';

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

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  const hr = Math.round(diff / 3_600_000);
  const day = Math.round(diff / 86_400_000);
  if (min < 60) return `${min} min sedan`;
  if (hr < 24) return `${hr} tim sedan`;
  if (day < 7) return `${day} dgr sedan`;
  return new Date(iso).toLocaleDateString('sv-SE');
}

export default async function IdagPage() {
  const user = await requireUser();

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

  const runCount = new Map<string, { count: number; last: string }>();
  for (const r of runs) {
    const e = runCount.get(r.tool) || { count: 0, last: r.created };
    e.count++;
    if (r.created > e.last) e.last = r.created;
    runCount.set(r.tool, e);
  }

  const toolById = new Map(tools.map((t) => [t.id, t]));

  const myAssistants = tools
    .filter((t) => t.category === 'ai_per_startup' || t.category === 'ai_system_wide')
    .map((t) => ({ ...t, runs: runCount.get(t.id)?.count || 0 }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6);

  const recentRuns = runs.slice(0, 5);

  const firstName = user.name.split(' ')[0] || user.email;

  const rail = (
    <>
      <RailSection
        label="Assistenter"
        action={
          <a
            href="/toolbox"
            className="text-[11px] text-foreground-subtle hover:text-foreground"
          >
            Alla
          </a>
        }
      >
        {myAssistants.length === 0 ? (
          <RailEmpty>Inga assistenter aktiverade.</RailEmpty>
        ) : (
          myAssistants.map((a) => (
            <RailItem
              key={a.id}
              icon="sparkle"
              iconTone="accent"
              title={a.name}
              meta={a.runs ? `${a.runs} körningar` : 'Ingen aktivitet'}
              href={`/toolbox/${a.id}`}
            />
          ))
        )}
      </RailSection>

      {recentRuns.length > 0 && (
        <RailSection label="Senaste körningar">
          {recentRuns.map((r) => {
            const t = toolById.get(r.tool);
            return (
              <RailItem
                key={r.id}
                icon="dot"
                iconTone="neutral"
                title={t?.name || 'Körning'}
                meta={formatRel(r.created)}
                href={t ? `/toolbox/${t.id}` : undefined}
              />
            );
          })}
        </RailSection>
      )}
    </>
  );

  return (
    <PageShell title={`${greeting()}, ${firstName}.`} rightPanel={rail} scroll={false} noPad>
      <div className="flex min-h-0 flex-1 flex-col px-6 py-5 lg:px-10 lg:py-8">
        <p className="mb-5 max-w-[60ch] text-[13.5px] text-foreground-muted">
          Ställ en fråga om portföljen, eller starta en assistent från panelen till höger.
        </p>
        <div className="min-h-0 flex-1">
          <DashboardChat className="h-full" />
        </div>
      </div>
    </PageShell>
  );
}
