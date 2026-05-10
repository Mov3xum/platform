import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PhaseBadge, StatusBadge, ToolCategoryBadge, ToolRunStatusBadge } from '@/components/Badges';
import { NoteForm } from '@/components/NoteForm';
import {
  activityStatusLabels,
  activityTypeLabels,
  agreementKindLabels,
  agreementStatusLabels,
  milestoneCategoryLabels,
  milestoneStatusLabels,
  toolRunStatusLabels,
  type ActivityStatus,
  type ActivityType,
  type AgreementKind,
  type AgreementStatus,
  type MilestoneCategory,
  type MilestoneStatus,
  type StartupStatus,
  type ToolRunStatus
} from '@/lib/labels';
import type { StartupPhase } from '@platform/shared';

interface StartupRecord {
  id: string;
  tenant: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  tags?: string;
  created: string;
  updated: string;
}

interface NoteRecord {
  id: string;
  body: string;
  author: string;
  confidential: boolean;
  created: string;
  expand?: { author?: { id: string; display_name?: string; email: string } };
}

interface MilestoneRecord {
  id: string;
  title: string;
  description?: string;
  category: MilestoneCategory;
  status: MilestoneStatus;
  target_date?: string;
  achieved_at?: string;
}

interface ActivityRecord {
  id: string;
  title: string;
  type: ActivityType;
  status: ActivityStatus;
  kind?: string;
  tool?: string;
  tool_run?: string;
  due_date?: string;
  description?: string;
  expand?: {
    tool?: { id: string; name: string; icon?: string; category: string };
    tool_run?: { id: string; status: string };
  };
}

interface AgreementRecord {
  id: string;
  title: string;
  kind: AgreementKind;
  status: AgreementStatus;
  signed_at?: string;
  expires_at?: string;
}

interface TeamMemberRecord {
  id: string;
  name: string;
  role_title?: string;
  email?: string;
  is_founder?: boolean;
}

interface PartnerEngagementRecord {
  id: string;
  engagement_type: string;
  started_at?: string;
  amount_sek?: number;
  expand?: { partner?: { id: string; name: string; type: string } };
}

interface ToolActivityRecord {
  id: string;
  title: string;
  type: ActivityType;
  status: ActivityStatus;
  kind?: string;
  tool?: string;
  tool_run?: string;
  due_date?: string;
  created: string;
  expand?: {
    tool?: { id: string; name: string; icon?: string; category: string };
    tool_run?: { id: string; status: string };
  };
}

export default async function StartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  let startup: StartupRecord;
  try {
    startup = await getOneForTenant<StartupRecord>('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();

  const emptyList = { items: [], totalItems: 0 };
  const [
    teamResult,
    milestonesResult,
    activitiesResult,
    notesResult,
    agreementsResult,
    engagementsResult,
    toolActivitiesResult
  ] = await Promise.allSettled([
    pb.collection('startup_team_members').getList<TeamMemberRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-is_founder,name'
    }),
    pb.collection('milestones').getList<MilestoneRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: 'target_date'
    }),
    pb.collection('activities').getList<ActivityRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-due_date',
      expand: 'tool,tool_run'
    }),
    pb.collection('notes').getList<NoteRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-created',
      expand: 'author'
    }),
    pb.collection('agreements').getList<AgreementRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-signed_at'
    }),
    pb.collection('partner_engagements').getList<PartnerEngagementRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-started_at',
      expand: 'partner'
    }),
    pb.collection('activities').getList<ToolActivityRecord>(1, 50, {
      filter: `startup = "${id}" && kind = "tool_run"`,
      sort: '-created',
      expand: 'tool,tool_run'
    })
  ]);

  const team = teamResult.status === 'fulfilled' ? teamResult.value : emptyList;
  const milestones = milestonesResult.status === 'fulfilled' ? milestonesResult.value : emptyList;
  const activities = activitiesResult.status === 'fulfilled' ? activitiesResult.value : emptyList;
  const notes = notesResult.status === 'fulfilled' ? notesResult.value : emptyList;
  const agreements = agreementsResult.status === 'fulfilled' ? agreementsResult.value : emptyList;
  const engagements = engagementsResult.status === 'fulfilled' ? engagementsResult.value : emptyList;
  const toolActivities = toolActivitiesResult.status === 'fulfilled' ? toolActivitiesResult.value : emptyList;

  const sectionLoadFailed = [
    teamResult,
    milestonesResult,
    activitiesResult,
    notesResult,
    agreementsResult,
    engagementsResult,
    toolActivitiesResult
  ].some((result) => result.status === 'rejected');

  if (sectionLoadFailed) {
    console.error('[startup/detail] one or more sections failed to load', {
      tenant: user.tenant,
      userId: user.id,
      startupId: id
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/startups" className="text-sm text-foreground-muted hover:text-foreground">
          ← Alla bolag
        </Link>
      </div>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <PhaseBadge phase={startup.phase} />
            <StatusBadge status={startup.status} />
            {startup.irl_level ? (
              <span className="inline-flex items-center rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
                IRL {startup.irl_level}
              </span>
            ) : null}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{startup.name}</h1>
          {startup.next_step ? (
            <p className="mt-2 text-sm text-foreground-muted">
              <span className="font-medium text-foreground-muted">Nästa steg:</span> {startup.next_step}
            </p>
          ) : null}
        </div>
        {canEdit && (
          <Link
            href={`/startups/${id}/edit`}
            className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
          >
            Redigera
          </Link>
        )}
      </header>

      <nav className="mb-8 flex flex-wrap gap-3 text-sm">
        {[
          ['#overview', 'Översikt'],
          ['#team', `Team (${team.totalItems})`],
          ['#milestones', `Milstolpar (${milestones.totalItems})`],
          ['#activities', `Aktiviteter (${activities.totalItems})`],
          ['#notes', `Anteckningar (${notes.totalItems})`],
          ['#agreements', `Avtal (${agreements.totalItems})`],
          ['#partners', `Partners (${engagements.totalItems})`],
          ['#tools', `Verktyg (${toolActivities.totalItems})`]
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-full border border-default bg-surface px-3 py-1 font-medium text-foreground-muted transition hover:bg-canvas-subtle"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        {sectionLoadFailed ? (
          <div className="rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
            Vissa delar av bolagssidan kunde inte laddas just nu.
          </div>
        ) : null}

        <Section id="overview" title="Översikt">
          {startup.description ? (
            <div className="prose max-w-none text-sm text-foreground-muted dark:prose-invert" dangerouslySetInnerHTML={{ __html: startup.description }} />
          ) : (
            <Empty>Ingen beskrivning än.</Empty>
          )}
          {startup.tags ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {startup.tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                <span key={tag} className="rounded-full bg-canvas-subtle px-3 py-1 text-xs font-medium text-foreground-muted">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </Section>

        <Section id="team" title="Team">
          {team.items.length === 0 ? (
            <Empty>Inga teammedlemmar registrerade.</Empty>
          ) : (
            <ul className="divide-y divide-default">
              {team.items.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {m.name} {m.is_founder ? <span className="ml-1 text-xs text-link">(grundare)</span> : null}
                    </p>
                    {m.role_title ? <p className="text-sm text-foreground-muted">{m.role_title}</p> : null}
                  </div>
                  {m.email ? <a href={`mailto:${m.email}`} className="text-sm text-link hover:underline">{m.email}</a> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="milestones" title="Milstolpar">
          {milestones.items.length === 0 ? (
            <Empty>Inga milstolpar registrerade.</Empty>
          ) : (
            <ul className="space-y-3">
              {milestones.items.map((m) => (
                <li key={m.id} className="rounded-2xl border border-default p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{m.title}</p>
                      <p className="text-xs text-foreground-subtle">
                        {milestoneCategoryLabels[m.category]} ·{' '}
                        {m.target_date ? new Date(m.target_date).toLocaleDateString('sv-SE') : 'Inget måldatum'}
                      </p>
                    </div>
                    <StatusPill label={milestoneStatusLabels[m.status]} variant={m.status === 'achieved' ? 'success' : m.status === 'missed' ? 'danger' : 'neutral'} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="activities" title="Aktiviteter">
          {activities.items.length === 0 ? (
            <Empty>Inga aktiviteter registrerade.</Empty>
          ) : (
            <ul className="space-y-3">
              {activities.items.map((a) => (
                <li key={a.id} className="rounded-2xl border border-default p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{a.title}</p>
                      <p className="text-xs text-foreground-subtle">
                        {activityTypeLabels[a.type]} ·{' '}
                        {a.due_date ? new Date(a.due_date).toLocaleDateString('sv-SE') : 'Inget datum'}
                      </p>
                    </div>
                    <StatusPill label={activityStatusLabels[a.status]} variant={a.status === 'done' ? 'success' : a.status === 'cancelled' ? 'neutral' : 'info'} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="notes" title="Anteckningar">
          <div className="mb-6 rounded-2xl border border-default bg-canvas-subtle/50 p-4">
            <NoteForm startupId={id} />
          </div>
          {notes.items.length === 0 ? (
            <Empty>Inga anteckningar än.</Empty>
          ) : (
            <ul className="space-y-3">
              {notes.items.map((n) => (
                <li key={n.id} className="rounded-2xl border border-default p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-foreground-subtle">
                    <span>
                      {n.expand?.author?.display_name || n.expand?.author?.email || 'Okänd'} ·{' '}
                      {new Date(n.created).toLocaleString('sv-SE')}
                    </span>
                    {n.confidential ? (
                      <span className="rounded-full bg-movexum-pastell-gul px-2 py-0.5 font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                        Konfidentiell
                      </span>
                    ) : null}
                  </div>
                  <div className="prose prose-sm max-w-none text-foreground-muted dark:prose-invert" dangerouslySetInnerHTML={{ __html: n.body }} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="agreements" title="Avtal">
          {agreements.items.length === 0 ? (
            <Empty>Inga avtal registrerade.</Empty>
          ) : (
            <ul className="space-y-3">
              {agreements.items.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-2xl border border-default p-4">
                  <div>
                    <p className="font-medium text-foreground">{a.title}</p>
                    <p className="text-xs text-foreground-subtle">
                      {agreementKindLabels[a.kind]} ·{' '}
                      {a.signed_at ? `signerat ${new Date(a.signed_at).toLocaleDateString('sv-SE')}` : 'osignerat'}
                    </p>
                  </div>
                  <StatusPill label={agreementStatusLabels[a.status]} variant={a.status === 'signed' ? 'success' : a.status === 'expired' || a.status === 'terminated' ? 'danger' : 'info'} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="partners" title="Partners">
          {engagements.items.length === 0 ? (
            <Empty>Inga partner-engagement.</Empty>
          ) : (
            <ul className="space-y-3">
              {engagements.items.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-2xl border border-default p-4">
                  <div>
                    <p className="font-medium text-foreground">{e.expand?.partner?.name || 'Okänd partner'}</p>
                    <p className="text-xs text-foreground-subtle">
                      {e.engagement_type}
                      {e.amount_sek ? ` · ${e.amount_sek.toLocaleString('sv-SE')} SEK` : ''}
                      {e.started_at ? ` · sedan ${new Date(e.started_at).toLocaleDateString('sv-SE')}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="tools" title="Verktyg">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-foreground-muted">
              Verktygskörningar kopplade till detta bolag.
            </p>
            <Link
              href={`/toolbox?startup=${id}`}
              className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              + Kör verktyg
            </Link>
          </div>
          {toolActivities.items.length === 0 ? (
            <Empty>Inga verktygskörningar än.</Empty>
          ) : (
            <ul className="space-y-3">
              {toolActivities.items.map((a) => (
                <li key={a.id} className="rounded-2xl border border-default p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {a.expand?.tool?.icon && (
                        <span className="text-lg">{a.expand.tool.icon}</span>
                      )}
                      <div>
                        <p className="font-medium text-foreground">
                          {a.tool_run ? (
                            <Link
                              href={`/toolbox/runs/${a.tool_run}`}
                              className="hover:text-brand hover:underline"
                            >
                              {a.title}
                            </Link>
                          ) : (
                            a.title
                          )}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {new Date(a.created).toLocaleString('sv-SE')}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {a.expand?.tool && (
                        <ToolCategoryBadge category={a.expand.tool.category as never} />
                      )}
                      {a.expand?.tool_run ? (
                        <ToolRunStatusBadge
                          status={a.expand.tool_run.status as ToolRunStatus}
                        />
                      ) : (
                        <StatusPill
                          label={activityStatusLabels[a.status]}
                          variant={a.status === 'done' ? 'success' : 'info'}
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground-subtle">{children}</p>;
}

function StatusPill({ label, variant }: { label: string; variant: 'success' | 'danger' | 'info' | 'neutral' }) {
  const classes = {
    success:
      'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
    danger:
      'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange',
    info:
      'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
    neutral:
      'bg-canvas-subtle text-foreground-muted ring-default'
  }[variant];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classes}`}>
      {label}
    </span>
  );
}
