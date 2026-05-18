import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { Icon } from '@/components/proto/Icon';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat, RailEmpty } from '@/components/PageRail';
import type { ToolRunStatus } from '@platform/shared';
import {
  ASSIGN_STATUS,
  formatDeadline,
  formatRelativeDate,
  daysUntil
} from '@/components/intric/constants';

interface RunRow {
  id: string;
  status: ToolRunStatus;
  tool: string;
  startup: string;
  deadline?: string;
  instruction?: string;
  created: string;
  expand?: {
    tool?: { id: string; name: string; category: string };
    startup?: { id: string; name: string };
    assigned_by?: { id: string; display_name?: string; email: string };
  };
}

export default async function InkorgPage() {
  const user = await requireUser();

  if (hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/idag');
  }

  const pb = await getServerPb();

  let runs: RunRow[] = [];
  try {
    const res = await pb.collection('tool_runs').getList<RunRow>(1, 100, {
      filter: pb.filter(
        'tenant = {:tenant} && assigned_to = {:userId} && (status = "assigned" || status = "in_progress" || status = "ready_for_review")',
        { tenant: user.tenant, userId: user.id }
      ),
      sort: 'deadline',
      expand: 'tool,startup,assigned_by'
    });
    runs = res.items;
  } catch {
    runs = [];
  }

  const todo = runs.filter((r) => r.status === 'assigned');
  const pågående = runs.filter((r) => r.status === 'in_progress');
  const väntar = runs.filter((r) => r.status === 'ready_for_review');
  const overdue = runs.filter((r) => {
    const d = daysUntil(r.deadline);
    return d !== null && d < 0 && r.status !== 'ready_for_review';
  });

  function Section({ label, items }: { label: string; items: RunRow[] }) {
    if (items.length === 0) return null;
    return (
      <section className="mb-7">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          {label}{' '}
          <span className="font-mono normal-case tracking-normal">{items.length}</span>
        </div>
        <div className="space-y-2">
          {items.map((r) => {
            const days = daysUntil(r.deadline);
            const isOverdue = days !== null && days < 0 && r.status !== 'ready_for_review';
            const status = ASSIGN_STATUS[r.status] || ASSIGN_STATUS.assigned;
            const startupId = r.startup;
            const startupName = r.expand?.startup?.name || 'Bolag';
            const toolName = r.expand?.tool?.name || 'Verktyg';
            const assignedByName =
              r.expand?.assigned_by?.display_name || r.expand?.assigned_by?.email || 'Coach';

            return (
              <Link
                key={r.id}
                href={`/startups/${startupId}/verktyg/${r.id}`}
                className="block rounded-xl border border-default bg-surface p-4 transition hover:border-strong"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
                    <Icon name="inbox" size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-foreground">{toolName}</h3>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${status.bgClass} ${status.fgClass}`}
                      >
                        <Icon name={status.iconName} size={10} /> {status.label}
                      </span>
                      <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] text-foreground-muted">
                        {startupName}
                      </span>
                    </div>
                    {r.instruction && (
                      <p
                        className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-muted"
                        dangerouslySetInnerHTML={{
                          __html: r.instruction.replace(/<script[\s\S]*?<\/script>/gi, '')
                        }}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="people" size={11} /> från {assignedByName}
                      </span>
                      {r.deadline && (
                        <span
                          className={`inline-flex items-center gap-1 ${isOverdue ? 'font-medium text-movexum-orange' : ''}`}
                        >
                          <Icon name="calendar" size={11} /> deadline{' '}
                          {formatDeadline(r.deadline)}
                          {isOverdue
                            ? ' (försenad)'
                            : days !== null && days >= 0
                              ? ` · om ${days} dgr`
                              : ''}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Icon name="clock" size={11} /> tilldelad{' '}
                        {formatRelativeDate(r.created)}
                      </span>
                    </div>
                  </div>
                  <Icon name="chevron" size={14} className="shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Att göra" value={todo.length} />
          <RailStat label="Pågående" value={pågående.length} />
          <RailStat label="Inväntar" value={väntar.length} />
          <RailStat label="Försenade" value={overdue.length} />
        </div>
      </RailSection>
    </>
  );

  return (
    <PageShell title={`Hej ${user.name.split(' ')[0]}.`} rightPanel={rail}>
      <div className="mx-auto w-full max-w-3xl py-6">
        <p className="mb-6 max-w-[60ch] text-[13.5px] text-foreground-muted">
          Det här är vad din coach har bett dig att fokusera på. Klicka på ett uppdrag för att se
          instruktionen — output sparas tillbaka på bolaget.
        </p>

        {runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-canvas-muted text-foreground-subtle">
              <Icon name="check" size={16} />
            </div>
            <p className="text-[13px] text-foreground-subtle">
              Inga aktiva uppdrag just nu. Allt klart.
            </p>
          </div>
        ) : (
          <>
            <Section label="Att göra nu" items={todo} />
            <Section label="Pågående" items={pågående} />
            <Section label="Inväntar coach" items={väntar} />
          </>
        )}
      </div>
    </PageShell>
  );
}
