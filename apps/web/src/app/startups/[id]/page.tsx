import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import {
  PhaseBadge,
  StatusBadge,
  ToolCategoryBadge,
  ToolRunStatusBadge,
  WorkshopAssignmentStatusBadge
} from '@/components/Badges';
import { StartupHubActions } from '@/components/StartupHubActions';
import {
  activityStatusLabels,
  activityTypeLabels,
  agreementKindLabels,
  agreementStatusLabels,
  type ActivityStatus,
  type ActivityType,
  type AgreementKind,
  type AgreementStatus,
  type MilestoneStatus,
  type StartupStatus,
  type ToolRunStatus
} from '@/lib/labels';
import { SPRINT_X_AXES, type StartupPhase, type SprintXScore } from '@platform/shared';
import type { Workshop } from '@platform/shared';

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
  sprint_x_json?: SprintXScore;
  coaches?: string[];
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
  category: string;
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
  created: string;
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

interface WorkshopAssignmentRecord {
  id: string;
  status: 'planned' | 'in_progress' | 'done';
  due_date?: string;
  created: string;
  completed_at?: string;
  expand?: {
    workshop?: { id: string; title: string; version?: string };
    assigned_by?: { id: string; display_name?: string; email: string };
  };
}

type FeedItem =
  | { kind: 'note'; data: NoteRecord; date: string }
  | { kind: 'activity'; data: ActivityRecord; date: string }
  | { kind: 'workshop'; data: WorkshopAssignmentRecord; date: string };

const milestoneStatusDot: Record<MilestoneStatus, string> = {
  planned: 'bg-canvas-muted border-2 border-default',
  in_progress: 'bg-movexum-bla',
  achieved: 'bg-movexum-gron',
  missed: 'bg-movexum-orange'
};

export default async function StartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'startups', user.disabledModules)) notFound();
  const canEdit = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const canAssign = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isScopedViewer =
    hasRole(user.roles, ['startup_member', 'partner']) &&
    !hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  if (isScopedViewer && !user.linkedStartups.includes(id)) {
    notFound();
  }

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
    workshopAssignmentsResult,
    workshopsResult
  ] = await Promise.allSettled([
    pb.collection('startup_team_members').getList<TeamMemberRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-is_founder,name'
    }),
    pb.collection('milestones').getList<MilestoneRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: 'target_date'
    }),
    pb.collection('activities').getList<ActivityRecord>(1, 80, {
      filter: `startup = "${id}"`,
      sort: '-created',
      expand: 'tool,tool_run'
    }),
    pb.collection('notes').getList<NoteRecord>(1, 80, {
      filter: `startup = "${id}"`,
      sort: '-created',
      expand: 'author'
    }),
    pb.collection('agreements').getList<AgreementRecord>(1, 20, {
      filter: `startup = "${id}"`,
      sort: '-signed_at'
    }),
    pb.collection('partner_engagements').getList<PartnerEngagementRecord>(1, 20, {
      filter: `startup = "${id}"`,
      sort: '-started_at',
      expand: 'partner'
    }),
    pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopAssignmentRecord>(1, 50, {
      filter: `startup = "${id}" && tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'workshop,assigned_by'
    }),
    pb.collection(PB_COLLECTIONS.workshops).getList<Workshop>(1, 200, {
      filter: `tenant = "${user.tenant}" && active = true`,
      sort: 'title',
      fields: 'id,title'
    })
  ]);

  const team = teamResult.status === 'fulfilled' ? teamResult.value : emptyList;
  const milestones = milestonesResult.status === 'fulfilled' ? milestonesResult.value : emptyList;
  const activities = activitiesResult.status === 'fulfilled' ? activitiesResult.value : emptyList;
  const notes = notesResult.status === 'fulfilled' ? notesResult.value : emptyList;
  const agreements = agreementsResult.status === 'fulfilled' ? agreementsResult.value : emptyList;
  const engagements =
    engagementsResult.status === 'fulfilled' ? engagementsResult.value : emptyList;
  const workshopAssignments =
    workshopAssignmentsResult.status === 'fulfilled' ? workshopAssignmentsResult.value : emptyList;
  const workshops =
    workshopsResult.status === 'fulfilled' ? workshopsResult.value.items : [];

  // Build unified feed sorted newest-first
  const feed: FeedItem[] = [
    ...notes.items.map((n): FeedItem => ({ kind: 'note', data: n, date: n.created })),
    ...activities.items.map((a): FeedItem => ({ kind: 'activity', data: a, date: a.created })),
    ...workshopAssignments.items.map(
      (w): FeedItem => ({ kind: 'workshop', data: w, date: w.created })
    )
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const sprintX = startup.sprint_x_json ?? { funding: 0, intl: 0, sustain: 0, team: 0 };
  const achievedMilestones = milestones.items.filter((m) => m.status === 'achieved').length;
  const workshopOptions = workshops.map((w) => ({ id: w.id, title: w.title }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Breadcrumb bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/startups"
          className="inline-flex items-center gap-1 text-sm text-foreground-muted transition hover:text-foreground"
        >
          <span aria-hidden>←</span> Alla bolag
        </Link>
        <div className="flex gap-2">
          {canEdit && (
            <Link
              href={`/startups/${id}/edit`}
              className="inline-flex items-center gap-1 rounded-full border border-default bg-surface px-4 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              ✏️ Redigera
            </Link>
          )}
          <Link
            href={`/toolbox?startup=${id}&category=ai_per_startup`}
            className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            ✦ Kör AI-agent
          </Link>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[340px_1fr] lg:items-start lg:gap-8">
        {/* LEFT SIDEBAR */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-8">
          {/* Hero gradient card */}
          <div className="relative overflow-hidden rounded-3xl shadow-md shadow-movexum-svart/10">
            <div className="absolute inset-0 bg-gradient-to-br from-movexum-morkbla via-movexum-morklila to-movexum-morkbla opacity-95" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(255,255,255,0.08)_0%,_transparent_60%)]" />
            <div className="relative p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <PhaseBadge phase={startup.phase} />
                <StatusBadge status={startup.status} />
                {startup.irl_level ? (
                  <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/90 ring-1 ring-white/20">
                    IRL {startup.irl_level}
                    <span className="ml-1 text-white/50">/ 9</span>
                  </span>
                ) : null}
              </div>
              <h1 className="text-2xl font-bold text-white">{startup.name}</h1>
              {startup.irl_level ? (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-white/70 transition-all"
                      style={{ width: `${(startup.irl_level / 9) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-white/50">
                    IRL {startup.irl_level} av 9
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Next step */}
          {startup.next_step ? (
            <div className="rounded-2xl border-l-4 border-movexum-bla bg-movexum-pastell-bla/60 p-4 shadow-sm dark:border-movexum-djupbla dark:bg-movexum-morkbla/30">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-movexum-djupbla dark:text-movexum-bla">
                📌 Nästa steg
              </p>
              <p className="text-sm font-medium text-foreground">{startup.next_step}</p>
            </div>
          ) : null}

          {/* Description */}
          {startup.description ? (
            <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Beskrivning
              </p>
              <div
                className="prose prose-sm line-clamp-4 max-w-none text-foreground-muted dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: startup.description }}
              />
            </div>
          ) : null}

          {/* Tags */}
          {startup.tags ? (
            <div className="flex flex-wrap gap-1.5">
              {startup.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-canvas-subtle px-2.5 py-1 text-xs font-medium text-foreground-muted ring-1 ring-default"
                  >
                    #{tag}
                  </span>
                ))}
            </div>
          ) : null}

          {/* SprintX readiness */}
          <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Readiness
            </p>
            <div className="space-y-2.5">
              {SPRINT_X_AXES.map((axis) => {
                const value = (sprintX[axis.id as keyof SprintXScore] as number) ?? 0;
                const colors: Record<string, { bar: string; text: string }> = {
                  funding: { bar: 'bg-movexum-gul', text: 'text-movexum-morkgul' },
                  intl: {
                    bar: 'bg-movexum-bla',
                    text: 'text-movexum-djupbla dark:text-movexum-bla'
                  },
                  sustain: {
                    bar: 'bg-movexum-gron',
                    text: 'text-movexum-morkgron dark:text-movexum-pastell-gron'
                  },
                  team: {
                    bar: 'bg-movexum-lila',
                    text: 'text-movexum-morklila dark:text-movexum-pastell-lila'
                  }
                };
                const col = colors[axis.id] ?? {
                  bar: 'bg-foreground-muted',
                  text: 'text-foreground-muted'
                };
                return (
                  <div key={axis.id}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`text-xs font-medium ${col.text}`}>{axis.label}</span>
                      <span className={`text-xs font-bold tabular-nums ${col.text}`}>
                        {Math.round(value)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-canvas-subtle">
                      <div
                        className={`h-full rounded-full transition-all ${col.bar}`}
                        style={{ width: `${Math.min(100, value)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team */}
          <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Team ({team.totalItems})
            </p>
            {team.items.length === 0 ? (
              <p className="text-sm text-foreground-subtle">Inga teammedlemmar registrerade.</p>
            ) : (
              <ul className="space-y-2">
                {team.items.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila text-xs font-bold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {m.name}
                        {m.is_founder ? (
                          <span className="ml-1.5 text-xs font-normal text-movexum-djupbla dark:text-movexum-bla">
                            grundare
                          </span>
                        ) : null}
                      </p>
                      {m.role_title ? (
                        <p className="truncate text-xs text-foreground-muted">{m.role_title}</p>
                      ) : null}
                    </div>
                    {m.email ? (
                      <a
                        href={`mailto:${m.email}`}
                        className="text-xs text-link hover:underline"
                        title={m.email}
                      >
                        ✉
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Milestones */}
          {milestones.items.length > 0 ? (
            <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Milstolpar
                </p>
                <span className="text-xs text-foreground-muted">
                  {achievedMilestones} / {milestones.totalItems}
                </span>
              </div>
              {milestones.totalItems > 0 && (
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-canvas-subtle">
                  <div
                    className="h-full rounded-full bg-movexum-gron transition-all"
                    style={{
                      width: `${(achievedMilestones / milestones.totalItems) * 100}%`
                    }}
                  />
                </div>
              )}
              <ul className="space-y-1.5">
                {milestones.items.slice(0, 6).map((m) => (
                  <li key={m.id} className="flex items-start gap-2.5">
                    <span
                      className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${milestoneStatusDot[m.status]}`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm leading-snug ${m.status === 'achieved' ? 'text-foreground-muted line-through' : 'text-foreground'}`}
                      >
                        {m.title}
                      </p>
                      {m.target_date ? (
                        <p className="text-xs text-foreground-subtle">
                          {new Date(m.target_date).toLocaleDateString('sv-SE')}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
                {milestones.totalItems > 6 && (
                  <li className="pt-1 text-xs text-foreground-subtle">
                    +{milestones.totalItems - 6} fler…
                  </li>
                )}
              </ul>
            </div>
          ) : null}

          {/* Agreements & Partners summary */}
          {(agreements.totalItems > 0 || engagements.totalItems > 0) && (
            <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Avtal & Kapital
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-canvas-subtle/60 p-3 text-center">
                  <p className="text-xl font-bold text-foreground">{agreements.totalItems}</p>
                  <p className="text-xs text-foreground-muted">avtal</p>
                </div>
                <div className="rounded-xl bg-canvas-subtle/60 p-3 text-center">
                  <p className="text-xl font-bold text-foreground">{engagements.totalItems}</p>
                  <p className="text-xs text-foreground-muted">kapital</p>
                </div>
              </div>
              {engagements.items.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {engagements.items.slice(0, 3).map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium text-foreground">
                        {e.expand?.partner?.name || 'Okänd partner'}
                      </span>
                      {e.amount_sek ? (
                        <span className="ml-2 flex-shrink-0 text-foreground-muted">
                          {e.amount_sek.toLocaleString('sv-SE')} kr
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Quick links */}
          <div className="grid grid-cols-2 gap-2">
            {canEdit && (
              <Link
                href={`/startups/${id}/edit`}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-default bg-surface px-3 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                ✏️ Redigera
              </Link>
            )}
            <Link
              href={`/toolbox?startup=${id}&category=ai_per_startup`}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
            >
              ✦ AI-agent
            </Link>
            <Link
              href={`/toolbox?startup=${id}&category=template`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-default bg-surface px-3 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              📄 Mallar
            </Link>
            <Link
              href={`/toolbox?startup=${id}&category=checklist`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-default bg-surface px-3 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              ✅ Checklistor
            </Link>
          </div>
        </aside>

        {/* RIGHT: HUB STREAM */}
        <div className="min-w-0 space-y-5">
          {/* Stats bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Aktiviteter" value={activities.totalItems} color="bla" />
            <StatCard label="Anteckningar" value={notes.totalItems} color="lila" />
            <StatCard label="Workshops" value={workshopAssignments.totalItems} color="gron" />
            <StatCard label="Milstolpar" value={milestones.totalItems} color="gul" />
          </div>

          {/* Quick action panel */}
          <StartupHubActions
            startupId={id}
            workshops={workshopOptions}
            canAssign={canAssign}
          />

          {/* Activity stream */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-subtle">
                Aktivitetsflöde
              </h2>
              <span className="text-xs text-foreground-subtle">{feed.length} händelser</span>
            </div>

            {feed.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-10 text-center">
                <p className="text-foreground-subtle">
                  Inga händelser ännu. Lägg till en anteckning eller tilldela en övning ovan.
                </p>
              </div>
            ) : (
              <div className="relative space-y-3">
                <div className="absolute bottom-0 left-5 top-5 hidden w-px bg-border-default opacity-30 sm:block" />
                {feed.map((item, idx) => (
                  <FeedCard key={`${item.kind}-${item.data.id}-${idx}`} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Workshop assignments */}
          {workshopAssignments.items.length > 0 && (
            <HubSection title="Tilldelade övningar" count={workshopAssignments.totalItems}>
              <ul className="space-y-3">
                {workshopAssignments.items.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default p-4"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        <Link
                          href={`/education/assignments/${assignment.id}`}
                          className="hover:text-brand hover:underline"
                        >
                          {assignment.expand?.workshop?.title || 'Workshop'}
                        </Link>
                      </p>
                      <p className="mt-0.5 text-xs text-foreground-subtle">
                        Av{' '}
                        {assignment.expand?.assigned_by?.display_name ||
                          assignment.expand?.assigned_by?.email ||
                          'Okänd'}
                        {' · '}
                        {new Date(assignment.created).toLocaleDateString('sv-SE')}
                        {assignment.due_date
                          ? ` · Deadline ${new Date(assignment.due_date).toLocaleDateString('sv-SE')}`
                          : ''}
                      </p>
                    </div>
                    <WorkshopAssignmentStatusBadge status={assignment.status} />
                  </li>
                ))}
              </ul>
            </HubSection>
          )}

          {/* Agreements */}
          {agreements.items.length > 0 && (
            <HubSection title="Avtal" count={agreements.totalItems}>
              <ul className="space-y-3">
                {agreements.items.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-default p-4"
                  >
                    <div>
                      <p className="font-medium text-foreground">{a.title}</p>
                      <p className="text-xs text-foreground-subtle">
                        {agreementKindLabels[a.kind]}
                        {a.signed_at
                          ? ` · signerat ${new Date(a.signed_at).toLocaleDateString('sv-SE')}`
                          : ' · osignerat'}
                      </p>
                    </div>
                    <AgreementStatusPill status={a.status} label={agreementStatusLabels[a.status]} />
                  </li>
                ))}
              </ul>
            </HubSection>
          )}
        </div>
      </div>
    </main>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  if (item.kind === 'note') {
    const n = item.data as NoteRecord;
    return (
      <div className="relative flex gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong sm:pl-14">
        <div className="absolute left-3.5 top-5 hidden h-3 w-3 rounded-full border-2 border-movexum-bla bg-canvas sm:block" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila text-xs font-bold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
                {(n.expand?.author?.display_name || n.expand?.author?.email || '?')
                  .charAt(0)
                  .toUpperCase()}
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {n.expand?.author?.display_name || n.expand?.author?.email || 'Okänd'}
                </p>
                <p className="text-xs text-foreground-subtle">
                  {new Date(n.created).toLocaleString('sv-SE')}
                </p>
              </div>
            </div>
            {n.confidential ? (
              <span className="rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-xs font-medium text-movexum-morkgul ring-1 ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                Konfidentiell
              </span>
            ) : null}
          </div>
          <div
            className="prose prose-sm max-w-none text-foreground-muted dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: n.body }}
          />
        </div>
      </div>
    );
  }

  if (item.kind === 'workshop') {
    const w = item.data as WorkshopAssignmentRecord;
    return (
      <div className="relative flex gap-4 rounded-2xl border border-movexum-pastell-lila bg-movexum-pastell-lila/20 p-4 shadow-sm shadow-movexum-svart/5 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10 sm:pl-14">
        <div className="absolute left-3.5 top-5 hidden h-3 w-3 rounded-full bg-movexum-lila sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-movexum-morklila dark:text-movexum-pastell-lila">
                🎓 Övning tilldelad
              </p>
              <p className="font-medium text-foreground">
                <Link
                  href={`/education/assignments/${w.id}`}
                  className="hover:text-brand hover:underline"
                >
                  {w.expand?.workshop?.title || 'Workshop'}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-foreground-subtle">
                Av{' '}
                {w.expand?.assigned_by?.display_name ||
                  w.expand?.assigned_by?.email ||
                  'Okänd'}
                {' · '}
                {new Date(w.created).toLocaleString('sv-SE')}
                {w.due_date
                  ? ` · Deadline ${new Date(w.due_date).toLocaleDateString('sv-SE')}`
                  : ''}
              </p>
            </div>
            <WorkshopAssignmentStatusBadge status={w.status} />
          </div>
        </div>
      </div>
    );
  }

  const a = item.data as ActivityRecord;
  const isToolRun = a.kind === 'tool_run';
  return (
    <div className="relative flex gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong sm:pl-14">
      <div className="absolute left-3.5 top-5 hidden h-3 w-3 rounded-full border-2 border-default bg-canvas-subtle sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {a.expand?.tool?.icon && (
              <span className="mt-0.5 flex-shrink-0 text-base">{a.expand.tool.icon}</span>
            )}
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {isToolRun && a.tool_run ? (
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
              <p className="mt-0.5 text-xs text-foreground-subtle">
                {activityTypeLabels[a.type]}
                {a.due_date ? ` · ${new Date(a.due_date).toLocaleDateString('sv-SE')}` : ''}
                {' · '}
                {new Date(a.created).toLocaleString('sv-SE')}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            {isToolRun && a.expand?.tool ? (
              <ToolCategoryBadge category={a.expand.tool.category as never} />
            ) : null}
            {isToolRun && a.expand?.tool_run ? (
              <ToolRunStatusBadge status={a.expand.tool_run.status as ToolRunStatus} />
            ) : (
              <ActivityStatusPill status={a.status} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color
}: {
  label: string;
  value: number;
  color: 'bla' | 'lila' | 'gron' | 'gul';
}) {
  const bg: Record<typeof color, string> = {
    bla: 'border-movexum-bla/20 bg-movexum-pastell-bla/60 dark:bg-movexum-morkbla/30',
    lila: 'border-movexum-pastell-lila bg-movexum-pastell-lila/60 dark:bg-movexum-morklila/30',
    gron: 'border-movexum-gron/20 bg-movexum-pastell-gron/60 dark:bg-movexum-morkgron/30',
    gul: 'border-movexum-gul/20 bg-movexum-pastell-gul/60 dark:bg-movexum-morkgul/30'
  };
  const num: Record<typeof color, string> = {
    bla: 'text-movexum-djupbla dark:text-movexum-bla',
    lila: 'text-movexum-morklila dark:text-movexum-pastell-lila',
    gron: 'text-movexum-morkgron dark:text-movexum-pastell-gron',
    gul: 'text-movexum-morkgul dark:text-movexum-pastell-gul'
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm shadow-movexum-svart/5 ${bg[color]}`}>
      <p className={`text-2xl font-bold tabular-nums ${num[color]}`}>{value}</p>
      <p className="mt-0.5 text-xs text-foreground-muted">{label}</p>
    </div>
  );
}

function HubSection({
  title,
  count,
  children
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-canvas-subtle px-2 py-0.5 text-xs font-normal text-foreground-muted">
            {count}
          </span>
        )}
      </h2>
      {children}
    </div>
  );
}

function ActivityStatusPill({ status }: { status: ActivityStatus }) {
  const cls: Record<ActivityStatus, string> = {
    planned:
      'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla/40 dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
    in_progress:
      'bg-movexum-pastell-lila text-movexum-morklila ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
    done: 'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
    cancelled: 'bg-canvas-subtle text-foreground-muted ring-default'
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${cls[status]}`}
    >
      {activityStatusLabels[status]}
    </span>
  );
}

function AgreementStatusPill({ status, label }: { status: AgreementStatus; label: string }) {
  const cls: Record<AgreementStatus, string> = {
    draft: 'bg-canvas-subtle text-foreground-muted ring-default',
    sent: 'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla/40 dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
    signed:
      'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
    expired:
      'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
    terminated:
      'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange'
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${cls[status]}`}
    >
      {label}
    </span>
  );
}
