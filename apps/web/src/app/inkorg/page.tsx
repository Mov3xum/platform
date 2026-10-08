import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { NotificationList } from '@/components/inkorg/NotificationList';
import { MissionInboxList } from '@/components/inkorg/MissionInboxList';
import {
  listNotificationsForUser,
  pruneOldNotifications,
  toNotificationView
} from '@/lib/notifications-server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { ToolRunStatus, Mission } from '@platform/shared';
import { ASSIGN_STATUS, formatDeadline, formatRelativeDate, daysUntil } from '@/components/intric/constants';
import { getOverviewData, listStartupOptions } from '@/lib/overview/aggregate';
import { openCount, overdueCount } from '@/lib/overview/group';
import { OverviewWork } from '@/components/overview/OverviewWork';
import { AgendaStrip } from '@/components/overview/AgendaStrip';
import { QuickAdd } from '@/components/overview/QuickAdd';

export const dynamic = 'force-dynamic';

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

function ToolRunSection({ label, items }: { label: string; items: RunRow[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        {label} <span className="font-mono normal-case tracking-normal">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((r) => {
          const days = daysUntil(r.deadline);
          const overdue = days !== null && days < 0 && r.status !== 'ready_for_review';
          const status = ASSIGN_STATUS[r.status] || ASSIGN_STATUS.assigned;
          const startupId = r.startup;
          const startupName = r.expand?.startup?.name || 'Bolag';
          const toolName = r.expand?.tool?.name || 'Verktyg';
          const assignedByName =
            r.expand?.assigned_by?.display_name ||
            r.expand?.assigned_by?.email?.split('@')[0] ||
            'Coach';

          return (
            <Link
              key={r.id}
              href={`/startups/${startupId}/verktyg/${r.id}`}
              className="block rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-brand/40 hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                  <Icon name="sparkle" size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-[14.5px] font-semibold text-foreground">
                      {toolName}
                    </h3>
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
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-muted">
                      {r.instruction}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="people" size={11} /> från {assignedByName}
                    </span>
                    {r.deadline && (
                      <span
                        className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-movexum-orange' : ''}`}
                      >
                        <Icon name="calendar" size={11} /> deadline{' '}
                        {formatDeadline(r.deadline)}
                        {overdue
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

export default async function InkorgPage() {
  const user = await requireUser();
  const pb = await getServerPb();
  const isFounder = hasRole(user.roles, ['startup_member']);
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  // Lagringsminimering (§ 50): gamla notiser rensas best-effort i bakgrunden.
  void pruneOldNotifications(pb, user.id);

  // ── Aggregerad lista/tavla + agenda, notiser, uppdrag, bolagsval — parallellt ──
  const [overview, notifications, myMissions, startupOptions] = await Promise.all([
    getOverviewData(pb, user),
    listNotificationsForUser(pb, user.id, { limit: 50 }),
    (async (): Promise<Mission[]> => {
      try {
        const res = await pb.collection(PB_COLLECTIONS.missions).getList<Mission>(1, 50, {
          filter: pb.filter(
            '(issuer = {:u} || recipients = {:u} || mentor = {:u}) && status != "done" && status != "archived"',
            { u: user.id }
          ),
          sort: '-updated',
          expand: 'startup'
        });
        return res.items;
      } catch {
        return [];
      }
    })(),
    isStaff ? listStartupOptions(pb, user.tenant) : Promise.resolve([])
  ]);

  // ── Tool-runs för founders (behåll befintligt) ────────────
  let runs: RunRow[] = [];
  if (isFounder) {
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
  }

  const todo = runs.filter((r) => r.status === 'assigned');
  const pågående = runs.filter((r) => r.status === 'in_progress');
  const väntar = runs.filter((r) => r.status === 'ready_for_review');
  const notificationViews = notifications.map(toNotificationView);
  const unreadCount = notificationViews.filter((n) => !n.read).length;
  const firstName = user.name?.split(' ')[0] || user.name;
  const now = new Date();
  const open = openCount(overview.items);
  const overdue = overdueCount(overview.items, now);

  return (
    <PageShell
      title="Mina uppgifter"
      meta={
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-subtle">
          <span>Hej {firstName || 'där'}.</span>
          {unreadCount > 0 && (
            <a
              href="#notiser"
              className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-semibold text-brand-foreground"
            >
              <Icon name="bell" size={10} /> {unreadCount} olästa
            </a>
          )}
        </span>
      }
    >
      <div className="space-y-6 py-6">
        {overview.readNotices.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-movexum-orange/50 bg-surface px-3 py-2 text-[12.5px] text-foreground"
          >
            <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-movexum-orange" />
            <div className="flex-1 space-y-0.5">
              {overview.readNotices.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          </div>
        )}

        <AgendaStrip items={overview.agenda} outlookState={overview.outlookState} />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            <section>
              <h2 className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Att göra
                <span className="font-mono normal-case tracking-normal">{open}</span>
                {overdue > 0 && (
                  <span className="rounded-md bg-movexum-pastell-orange px-1.5 py-0.5 font-mono normal-case tracking-normal text-movexum-morkorange">
                    {overdue} försenade
                  </span>
                )}
              </h2>
              {isStaff && (
                <div className="mb-4">
                  <QuickAdd startupOptions={startupOptions} />
                </div>
              )}
              <OverviewWork
                items={overview.items}
                editable={overview.boardEditable}
                meId={user.id}
                startupOptions={startupOptions}
              />
            </section>

            {isFounder && runs.length > 0 && (
              <section>
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  AI-uppdrag från coach
                </h2>
                <ToolRunSection label="Att göra nu" items={todo} />
                <ToolRunSection label="Pågående" items={pågående} />
                <ToolRunSection label="Inväntar coach" items={väntar} />
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-8">
            <section id="notiser">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Notiser
                </h2>
                {unreadCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">
                    {unreadCount}
                  </span>
                )}
              </div>
              <NotificationList notifications={notificationViews} />
            </section>

            {myMissions.length > 0 && (
              <section>
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Mina projekt & uppdrag{' '}
                  <span className="font-mono normal-case tracking-normal">{myMissions.length}</span>
                </h2>
                <MissionInboxList missions={myMissions} />
              </section>
            )}
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
