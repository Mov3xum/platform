import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { markdownToHtml } from '@/lib/safe-html';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canAccessModule, hasRole } from '@/lib/rbac';
import {
  PhaseBadge,
  StatusBadge,
  ToolCategoryBadge,
  ToolRunStatusBadge,
  WorkshopAssignmentStatusBadge
} from '@/components/Badges';
import { NoteForm } from '@/components/NoteForm';
import { NoteItem } from '@/components/NoteItem';
import { StartupDetailDashboard } from '@/components/StartupDetailDashboard';
import { StartupWorkCards, type WorkCard } from '@/components/StartupWorkCards';
import {
  StartupPhaseHistoryList,
  type PhaseHistoryItem
} from '@/components/StartupPhaseHistoryList';
import { AllabolagSyncButton } from './AllabolagSyncButton';
import { LogMeetingButton } from './LogMeetingButton';
import {
  findIntegrationRow,
  getActiveTokens,
  markExpired
} from '@/lib/app-integrations/storage';
import { outlookCalendarProvider } from '@/lib/app-integrations/providers/outlook_calendar/provider';
import { fetchCalendarEvents } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import {
  matchEventsToContacts,
  matchedEventsForStartup,
  type EmailIndex,
  type EventMatch
} from '@/lib/app-integrations/providers/outlook_calendar/match';
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
import type {
  StartupPhase,
  SprintXScore,
  EducationDocumentAssignment
} from '@platform/shared';
import { educationDocumentKindLabels } from '@platform/shared';
import { Icon } from '@/components/proto';
import { DocumentCompleteButton } from '@/app/education/documents/DocumentCompleteButton';
import { pbFileUrl } from '@/lib/pb-file';

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
  org_nr?: string;
  kommun?: string;
  bolagsform?: string;
  industri?: string;
  bolag_status?: string;
  intagsdatum?: string;
  avslutsdatum?: string;
  // Movexum Bolagslista (1700000061)
  idea_name?: string;
  case_type?: string;
  status_completion_pct?: number;
  company_registered_at?: string;
  contacted_at?: string;
  signed_incubator_agreement?: boolean;
  signed_incubator_agreement_at?: string;
  signed_nda?: boolean;
  signed_nda_at?: string;
  potential_bc_case?: boolean;
  signed_bc_agreement?: boolean;
  signed_bc_agreement_at?: string;
  preliminary_exit?: string;
  is_deeptech?: boolean;
  meets_excellence_criteria?: boolean;
  inflow_source?: string;
  approved_state_aid_art22?: boolean;
  area?: string;
  signed_vinnova_incubation_approval?: boolean;
  signed_vinnova_incubation_approval_at?: string;
  approved_de_minimis?: boolean;
  sent_to?: string;
  register_notes?: string;
  is_regional?: boolean;
  signed_partner_agreement?: boolean;
  signed_partner_agreement_at?: string;
  created: string;
  updated: string;
}

interface PhaseHistoryRecord {
  id: string;
  phase: StartupPhase;
  entered_at: string;
  exited_at?: string;
  note?: string;
  expand?: { created_by?: { id: string; display_name?: string; email: string } };
}

type FinancialsSource = 'manual' | 'import_excel' | 'allabolag' | 'other';

interface FinancialsRow {
  id: string;
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
  source: FinancialsSource;
  synced_at?: string;
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

interface StartupContactRecord {
  id: string;
  contact: string;
  role?: string;
  is_primary?: boolean;
  expand?: {
    contact?: { id: string; first_name?: string; last_name?: string; email?: string };
  };
}

type TaskKind = 'call' | 'meeting' | 'email' | 'prep' | 'followup' | 'admin' | 'other';
type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

interface TaskRecord {
  id: string;
  kind: TaskKind;
  description: string;
  starts_at?: string;
  due_at?: string;
  completed_at?: string;
  status: TaskStatus;
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

interface WorkshopAssignmentRecord {
  id: string;
  status: 'planned' | 'in_progress' | 'done';
  due_date?: string;
  takeaway_json?: {
    summary?: string;
    keyInsights?: string;
    prioritizedActions?: string;
    artifacts?: string;
  };
  created: string;
  completed_at?: string;
  expand?: {
    workshop?: { id: string; title: string; version?: string };
    assigned_by?: { id: string; display_name?: string; email: string };
  };
}

interface ToolRunRecord {
  id: string;
  tool?: string;
  status: ToolRunStatus;
  deadline?: string;
  assigned_to?: string;
  created: string;
  output_md?: string;
  expand?: {
    tool?: { id: string; name: string; category: string };
    assigned_to?: { id: string; display_name?: string; email: string };
  };
}

export default async function StartupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();
  const canEdit = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const canManageDocs = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isLinkedMember =
    hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(id);
  const canCompleteDocs = canManageDocs || isLinkedMember;

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
    toolActivitiesResult,
    workshopAssignmentsResult,
    financialsResult,
    phaseHistoryResult,
    startupContactsResult,
    tasksResult,
    documentAssignmentsResult,
    toolRunsResult
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
    }),
    pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopAssignmentRecord>(1, 50, {
      filter: `startup = "${id}" && tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'workshop,assigned_by'
    }),
    pb.collection('startup_financials').getList<FinancialsRow>(1, 5, {
      filter: `startup = "${id}"`,
      sort: '-year'
    }),
    pb.collection('startup_phase_history').getList<PhaseHistoryRecord>(1, 50, {
      filter: `startup = "${id}"`,
      sort: '-entered_at',
      expand: 'created_by'
    }),
    pb.collection('startup_contacts').getList<StartupContactRecord>(1, 100, {
      filter: `startup = "${id}"`,
      expand: 'contact'
    }),
    pb.collection('tasks').getList<TaskRecord>(1, 50, {
      filter: `startup = "${id}" && tenant = "${user.tenant}"`,
      sort: '-starts_at'
    }),
    pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getList<EducationDocumentAssignment>(1, 100, {
        filter: `startup = "${id}" && tenant = "${user.tenant}"`,
        sort: '-created',
        expand: 'document,completed_by'
      }),
    pb.collection('tool_runs').getList<ToolRunRecord>(1, 100, {
      filter: `startup = "${id}" && tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'tool,assigned_to'
    })
  ]);

  const team = teamResult.status === 'fulfilled' ? teamResult.value : emptyList;
  const milestones = milestonesResult.status === 'fulfilled' ? milestonesResult.value : emptyList;
  const activities = activitiesResult.status === 'fulfilled' ? activitiesResult.value : emptyList;
  const notes = notesResult.status === 'fulfilled' ? notesResult.value : emptyList;
  const agreements = agreementsResult.status === 'fulfilled' ? agreementsResult.value : emptyList;
  const engagements = engagementsResult.status === 'fulfilled' ? engagementsResult.value : emptyList;
  const toolActivities = toolActivitiesResult.status === 'fulfilled' ? toolActivitiesResult.value : emptyList;
  const workshopAssignments =
    workshopAssignmentsResult.status === 'fulfilled' ? workshopAssignmentsResult.value : emptyList;
  const financials =
    financialsResult.status === 'fulfilled' ? financialsResult.value : emptyList;
  const phaseHistory =
    phaseHistoryResult.status === 'fulfilled' ? phaseHistoryResult.value : emptyList;
  const startupContacts =
    startupContactsResult.status === 'fulfilled' ? startupContactsResult.value : emptyList;
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : emptyList;
  const documentAssignments =
    documentAssignmentsResult.status === 'fulfilled' ? documentAssignmentsResult.value : emptyList;
  const toolRuns = toolRunsResult.status === 'fulfilled' ? toolRunsResult.value : emptyList;

  // Verktyg & utbildning — vad bolaget GJORT (grön bock) och vad som är
  // tilldelat men INTE gjort ännu (verktyg + workshops + dokument).
  const DONE_RUN_STATUSES = new Set<ToolRunStatus>([
    'succeeded',
    'approved',
    'ready_for_review'
  ]);
  const PENDING_RUN_STATUSES = new Set<ToolRunStatus>([
    'assigned',
    'in_progress',
    'queued',
    'running'
  ]);
  const dayMs = 86_400_000;
  const relDays = (iso?: string): string | undefined => {
    if (!iso) return undefined;
    const diff = Math.round((Date.now() - new Date(iso).getTime()) / dayMs);
    if (diff < 1) return 'i dag';
    if (diff === 1) return 'i går';
    if (diff < 30) return `för ${diff} dgr sedan`;
    return new Date(iso).toLocaleDateString('sv-SE');
  };
  const deadlineLabel = (iso?: string): { label?: string; overdue: boolean } => {
    if (!iso) return { overdue: false };
    const diff = Math.round((new Date(iso).getTime() - Date.now()) / dayMs);
    if (diff < 0) return { label: `försenad ${-diff} dgr`, overdue: true };
    if (diff === 0) return { label: 'deadline i dag', overdue: false };
    return { label: `deadline om ${diff} dgr`, overdue: false };
  };

  const doneWork: WorkCard[] = [];
  const pendingWork: WorkCard[] = [];

  for (const run of toolRuns.items) {
    if (run.status === 'rejected' || run.status === 'failed') continue;
    const card: WorkCard = {
      id: run.id,
      kind: 'tool',
      title: run.expand?.tool?.name || 'Verktyg',
      statusLabel: toolRunStatusLabels[run.status],
      href: `/startups/${id}/verktyg/${run.id}`
    };
    if (DONE_RUN_STATUSES.has(run.status)) {
      doneWork.push({ ...card, dateLabel: relDays(run.created) });
    } else if (PENDING_RUN_STATUSES.has(run.status)) {
      const dl = deadlineLabel(run.deadline);
      pendingWork.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }

  for (const wa of workshopAssignments.items) {
    const card: WorkCard = {
      id: wa.id,
      kind: 'workshop',
      title: wa.expand?.workshop?.title || 'Workshop',
      statusLabel: wa.status === 'done' ? 'Klar' : wa.status === 'in_progress' ? 'Pågår' : 'Planerad',
      href: `/education/assignments/${wa.id}`
    };
    if (wa.status === 'done') {
      doneWork.push({ ...card, dateLabel: relDays(wa.completed_at || wa.created) });
    } else {
      const dl = deadlineLabel(wa.due_date);
      pendingWork.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }

  for (const da of documentAssignments.items) {
    const doc = da.expand?.document;
    const card: WorkCard = {
      id: da.id,
      kind: 'document',
      title: doc?.title || 'Dokument',
      statusLabel: da.status === 'completed' ? 'Slutförd' : 'Tilldelad',
      href: `/startups/${id}#edu-documents`
    };
    if (da.status === 'completed') {
      doneWork.push({ ...card, dateLabel: relDays(da.completed_at || da.created) });
    } else {
      const dl = deadlineLabel(da.due_date);
      pendingWork.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }

  // CLAUDE.md § 14: bygg en transient e-post→entitet-index för att matcha
  // Outlook-möten mot detta bolags kontakter + teammedlemmar. Aldrig sparad.
  const canLogMeeting = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const emailIndex: EmailIndex = new Map();
  const addEmail = (
    email: string | undefined,
    entry: { kind: 'contact' | 'team'; refId: string; name: string }
  ) => {
    const key = email?.trim().toLowerCase();
    if (!key) return;
    const list = emailIndex.get(key) ?? [];
    list.push({ ...entry, startupId: id });
    emailIndex.set(key, list);
  };
  for (const sc of startupContacts.items) {
    const c = sc.expand?.contact;
    if (!c) continue;
    addEmail(c.email, {
      kind: 'contact',
      refId: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Kontakt'
    });
  }
  for (const m of team.items) {
    addEmail(m.email, { kind: 'team', refId: m.id, name: m.name });
  }

  // Live Outlook-möten för den inloggade användaren (per-user OAuth), matchade
  // mot bolagets kontakter. Fail-soft: Graph-fel bryter aldrig sidan.
  let outlookConnected = false;
  let outlookMeetings: EventMatch[] = [];
  let outlookError: string | null = null;
  if (emailIndex.size > 0) {
    try {
      const row = await findIntegrationRow(pb, user.id, 'outlook_calendar');
      if (row?.status === 'active' && row.auth_data) {
        outlookConnected = true;
        const tokens = await getActiveTokens({ pb, row, provider: outlookCalendarProvider });
        const now = Date.now();
        const events = await fetchCalendarEvents({
          tokens,
          from: new Date(now - 30 * 24 * 60 * 60 * 1000),
          to: new Date(now + 30 * 24 * 60 * 60 * 1000),
          timezone: 'Europe/Stockholm'
        });
        outlookMeetings = matchedEventsForStartup(
          matchEventsToContacts(events, emailIndex),
          id
        );
        // Senaste först.
        outlookMeetings.sort(
          (a, b) => Date.parse(b.event.start) - Date.parse(a.event.start)
        );
      }
    } catch (err) {
      outlookError = err instanceof Error ? err.message : 'Okänt fel mot Microsoft Graph.';
      const row = await findIntegrationRow(pb, user.id, 'outlook_calendar').catch(() => null);
      if (row) await markExpired(pb, row.id, outlookError);
    }
  }

  const phaseHistoryItems: PhaseHistoryItem[] = phaseHistory.items.map((row) => ({
    id: row.id,
    phase: row.phase,
    entered_at: row.entered_at,
    exited_at: row.exited_at,
    note: row.note,
    authorLabel:
      row.expand?.created_by?.display_name ||
      row.expand?.created_by?.email ||
      undefined
  }));

  const sectionLoadFailed = [
    teamResult,
    milestonesResult,
    activitiesResult,
    notesResult,
    agreementsResult,
    engagementsResult,
    toolActivitiesResult,
    workshopAssignmentsResult,
    financialsResult,
    phaseHistoryResult,
    startupContactsResult,
    tasksResult
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

      <StartupDetailDashboard
        startup={startup}
        metrics={{
          activitiesCount: activities.totalItems,
          notesCount: notes.totalItems,
          milestonesCount: milestones.totalItems,
          documentsCount: documentAssignments.totalItems,
          teamMembersCount: team.totalItems,
          workshopsCount: workshopAssignments.totalItems,
          toolRunsCount: toolActivities.totalItems
        }}
      />

      <div className="mt-8">
        <StartupWorkCards done={doneWork} pending={pendingWork} />
      </div>

      <nav className="mb-8 mt-8 flex flex-wrap gap-3 text-sm">
        {[
          ['#overview', 'Info'],
          ['#moten', `Möten & uppgifter (${tasks.totalItems})`],
          ['#phase-history', `Fashistorik (${phaseHistory.totalItems})`],
          ['#kunskap', 'Kunskap'],
          ['#notes', `Anteckningar (${notes.totalItems})`],
          ['#activities', `Aktiviteter (${activities.totalItems})`],
          ['#documents', 'Dokument'],
          ['#edu-documents', `Utbildningsdokument (${documentAssignments.totalItems})`],
          ['#team', `Personer (${team.totalItems})`],
          ['#milestones', `Inkubatorprocess (${milestones.totalItems})`],
          ['#readiness', 'Bolagsfas & Readiness'],
          ['#partners', `Kapital (${engagements.totalItems})`],
          ['#agreements', `Avtal (${agreements.totalItems})`],
          ['#partners', `Partners (${engagements.totalItems})`],
          ['#financials', `Finansiell historik (${financials.totalItems})`],
          ['#tools', `Verktyg (${toolActivities.totalItems})`],
          ['#workshops', `Workshops (${workshopAssignments.totalItems})`]
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
            <div className="prose max-w-none text-sm text-foreground-muted dark:prose-invert" dangerouslySetInnerHTML={{ __html: markdownToHtml(startup.description) }} />
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

          <div className="mt-5 rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">Verktygskoppling</p>
            <p className="mt-1 text-sm text-foreground-muted">Kör startup-specifika verktyg med förvalt bolag för snabbare analys och dokumentation.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/toolbox?startup=${id}&category=ai_per_startup`}
                className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                AI per bolag
              </Link>
              <Link
                href={`/toolbox?startup=${id}&category=template`}
                className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                Mallar
              </Link>
              <Link
                href={`/toolbox?startup=${id}&category=checklist`}
                className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                Checklistor
              </Link>
            </div>
          </div>
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
                  <NoteItem
                    noteId={n.id}
                    body={n.body}
                    confidential={n.confidential}
                    isAuthor={n.author === user.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="moten" title="Möten & uppgifter">
          <div className="space-y-6">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Möten från Outlook</h3>
                {outlookConnected ? (
                  <span className="text-[11px] uppercase tracking-[0.06em] text-foreground-subtle">
                    Live · din kalender
                  </span>
                ) : null}
              </div>
              {!outlookConnected ? (
                <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle/50 p-4 text-sm text-foreground-muted">
                  <Link href="/integrationer/outlook-calendar" className="text-link hover:underline">
                    Anslut din Outlook
                  </Link>{' '}
                  för att se möten med detta bolags kontakter direkt här. Read-only,
                  inget cachas.
                </div>
              ) : outlookError ? (
                <Empty>Kunde inte hämta möten just nu. Koppla om Outlook.</Empty>
              ) : outlookMeetings.length === 0 ? (
                <Empty>Inga möten (±30 dagar) med bolagets kontakter i din kalender.</Empty>
              ) : (
                <ul className="divide-y divide-default rounded-2xl border border-default">
                  {outlookMeetings.map((m) => (
                    <li key={m.event.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {m.event.webLink ? (
                            <a
                              href={m.event.webLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-brand hover:underline"
                            >
                              {m.event.subject}
                            </a>
                          ) : (
                            m.event.subject
                          )}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {new Date(m.event.start).toLocaleString('sv-SE', {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                          {m.contactName ? ` · ${m.contactName}` : ''}
                        </p>
                      </div>
                      {canLogMeeting ? (
                        <LogMeetingButton
                          subject={m.event.subject}
                          startsAt={m.event.start}
                          endsAt={m.event.end}
                          startupId={id}
                          contactId={m.contactRefId}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">
                Uppgifter (CRM)
              </h3>
              {tasks.items.length === 0 ? (
                <Empty>Inga uppgifter registrerade för bolaget.</Empty>
              ) : (
                <ul className="space-y-3">
                  {tasks.items.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-default p-4">
                      <div>
                        <p className="font-medium text-foreground">{t.description}</p>
                        <p className="text-xs text-foreground-subtle">
                          {taskKindLabels[t.kind]}
                          {t.starts_at
                            ? ` · ${new Date(t.starts_at).toLocaleDateString('sv-SE')}`
                            : ''}
                        </p>
                      </div>
                      <StatusPill
                        label={taskStatusLabels[t.status]}
                        variant={
                          t.status === 'done'
                            ? 'success'
                            : t.status === 'cancelled' || t.status === 'blocked'
                            ? 'neutral'
                            : 'info'
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>

        <Section id="phase-history" title="Fashistorik">
          <StartupPhaseHistoryList
            startupId={id}
            items={phaseHistoryItems}
            canEdit={canEdit}
            canDelete={hasRole(user.roles, ['admin'])}
          />
        </Section>

        <Section id="kunskap" title="Kunskap">
          <p className="mb-4 text-sm text-foreground-muted">
            Signerade avtal, godkännanden och status för inkubator­stöd. Datum
            registreras via Redigera.
          </p>
          <ul className="divide-y divide-default">
            <KnowledgeRow
              label="Inkubatoravtal"
              signed={startup.signed_incubator_agreement}
              date={startup.signed_incubator_agreement_at}
            />
            <KnowledgeRow
              label="Sekretessavtal (NDA)"
              signed={startup.signed_nda}
              date={startup.signed_nda_at}
            />
            <KnowledgeRow
              label="Boost Chamber-avtal"
              signed={startup.signed_bc_agreement}
              date={startup.signed_bc_agreement_at}
            />
            <KnowledgeRow
              label="Godkännande av inkubationsstöd från Vinnova"
              signed={startup.signed_vinnova_incubation_approval}
              date={startup.signed_vinnova_incubation_approval_at}
            />
            <KnowledgeRow
              label="Partneravtal"
              signed={startup.signed_partner_agreement}
              date={startup.signed_partner_agreement_at}
            />
            <KnowledgeRow
              label="Godkänd för statsstöd artikel 22"
              signed={startup.approved_state_aid_art22}
            />
            <KnowledgeRow
              label="Godkänd för de minimis"
              signed={startup.approved_de_minimis}
            />
          </ul>
        </Section>

        <Section id="documents" title="Dokument">
          <p className="text-sm text-foreground-muted">
            Samlad yta för avtal, verktygsutdata och dokumentation kopplad till bolaget.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="#agreements" className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Visa avtal
            </a>
            <a href="#tools" className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Visa verktygskörningar
            </a>
            <a href="#edu-documents" className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Tilldelade dokument
            </a>
          </div>
        </Section>

        <Section id="edu-documents" title="Tilldelade utbildningsdokument">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-foreground-muted">
              Dokument (PDF, Excel, PowerPoint, Word) som bolaget ska gå igenom.
            </p>
            {canManageDocs ? (
              <Link
                href="/education/documents"
                className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                Hantera dokument
              </Link>
            ) : null}
          </div>
          {documentAssignments.items.length === 0 ? (
            <Empty>Inga tilldelade dokument än.</Empty>
          ) : (
            <ul className="space-y-3">
              {documentAssignments.items.map((assignment) => {
                const doc = assignment.expand?.document;
                const fileUrl = doc ? pbFileUrl('education_documents', doc.id, doc.file) : null;
                const completed = assignment.status === 'completed';
                return (
                  <li key={assignment.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {completed ? (
                          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                            <Icon name="check" size={30} stroke={2.4} />
                          </span>
                        ) : (
                          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                            <Icon name="doc" size={22} />
                          </span>
                        )}
                        <div>
                          <p className="font-medium text-foreground">{doc?.title || 'Dokument'}</p>
                          <p className="text-xs text-foreground-subtle">
                            {doc ? educationDocumentKindLabels[doc.doc_kind] || 'Dokument' : 'Dokument'}
                            {completed && assignment.completed_at
                              ? ` · Slutförd ${new Date(assignment.completed_at).toLocaleDateString('sv-SE')}`
                              : ''}
                          </p>
                          {assignment.instructions ? (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">
                              {assignment.instructions}
                            </p>
                          ) : null}
                          {assignment.due_date ? (
                            <p className="mt-1 text-xs text-foreground-subtle">
                              Deadline:{' '}
                              {new Date(assignment.due_date).toLocaleDateString('sv-SE')}
                            </p>
                          ) : null}
                          {fileUrl ? (
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
                            >
                              <Icon name="download" size={14} /> Ladda ner
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {canCompleteDocs ? (
                        <DocumentCompleteButton
                          assignmentId={assignment.id}
                          completed={completed}
                          canReopen={canManageDocs}
                        />
                      ) : completed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-movexum-morkgron dark:text-movexum-gron">
                          Slutförd
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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

        <Section id="partners" title="Kapital">
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

        <Section id="ipr" title="IPR">
          <p className="text-sm text-foreground-muted">
            IPR-spårning aktiveras via verktygsmallar och checklistor tills dedikerad datamodell är på plats.
          </p>
          <div className="mt-3">
            <Link
              href={`/toolbox?startup=${id}&category=template`}
              className="inline-flex rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Öppna relevanta verktyg
            </Link>
          </div>
        </Section>

        <Section id="worktime" title="Arbetstid">
          <p className="text-sm text-foreground-muted">
            Arbetstid kan dokumenteras via aktiviteter och notes tills separat tidloggningsmodul aktiveras.
          </p>
          <div className="mt-3">
            <a href="#activities" className="inline-flex rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Gå till aktiviteter
            </a>
          </div>
        </Section>

        <Section id="actionplan" title="Handlingsplan">
          {startup.next_step ? (
            <p className="text-sm text-foreground-muted">
              Nästa steg: <span className="font-medium text-foreground">{startup.next_step}</span>
            </p>
          ) : (
            <Empty>Ingen handlingsplan definierad ännu.</Empty>
          )}
          <div className="mt-3">
            <a href="#milestones" className="inline-flex rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Knyt till milstolpar
            </a>
          </div>
        </Section>

        <Section id="goals" title="Globala målen">
          <p className="text-sm text-foreground-muted">
            Målspårning mot globala målen kan knytas via mallar/checklistor i verktygslådan.
          </p>
          <div className="mt-3">
            <Link
              href={`/toolbox?startup=${id}&category=checklist`}
              className="inline-flex rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Öppna checklista-verktyg
            </Link>
          </div>
        </Section>

        <Section id="metrics" title="Mätetal">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-default bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Aktiviteter</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{activities.totalItems}</p>
            </div>
            <div className="rounded-2xl border border-default bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Milstolpar</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{milestones.totalItems}</p>
            </div>
            <div className="rounded-2xl border border-default bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Verktygskörningar</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{toolActivities.totalItems}</p>
            </div>
          </div>
        </Section>

        <Section id="financials" title="Finansiell historik">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground-muted">
              Årsvis nyckeltal från årsredovisningar och manuella inlägg. Källa
              visas per rad.
            </p>
            {canEdit && startup.org_nr ? (
              <AllabolagSyncButton startupId={id} />
            ) : null}
          </div>
          {!startup.org_nr ? (
            <Empty>
              Fyll i organisationsnummer under "Redigera" för att aktivera
              Allabolag-synk.
            </Empty>
          ) : financials.items.length === 0 ? (
            <Empty>Inga årsrader registrerade än.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-default">
              <table className="w-full text-sm">
                <thead className="bg-canvas-subtle text-left text-xs uppercase tracking-wider text-foreground-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">År</th>
                    <th className="px-3 py-2 font-medium">Omsättning</th>
                    <th className="px-3 py-2 font-medium">Anställda</th>
                    <th className="px-3 py-2 font-medium">Personalkostnad</th>
                    <th className="px-3 py-2 font-medium">Bolagsskatt</th>
                    <th className="px-3 py-2 font-medium">Källa</th>
                  </tr>
                </thead>
                <tbody>
                  {financials.items.map((row) => (
                    <tr key={row.id} className="border-t border-default">
                      <td className="px-3 py-2 font-medium text-foreground">{row.year}</td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {formatSek(row.revenue_sek)}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {row.employees ?? '–'}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {formatSek(row.personnel_cost_sek)}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {formatSek(row.corporate_tax_sek)}
                      </td>
                      <td className="px-3 py-2">
                        <SourceBadge source={row.source} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

        <Section id="workshops" title="Workshops">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-foreground-muted">
              Tilldelade workshops och takeaways som lagrats direkt på bolagskortet.
            </p>
            <Link
              href={`/education`}
              className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Hantera workshops
            </Link>
          </div>
          {workshopAssignments.items.length === 0 ? (
            <Empty>Inga workshoptilldelningar än.</Empty>
          ) : (
            <ul className="space-y-3">
              {workshopAssignments.items.map((assignment) => {
                const takeaway = assignment.takeaway_json || {};
                return (
                  <li key={assignment.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">
                          <Link
                            href={`/education/assignments/${assignment.id}`}
                            className="hover:text-brand hover:underline"
                          >
                            {assignment.expand?.workshop?.title || 'Workshop'}
                          </Link>
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          Tilldelad av{' '}
                          {assignment.expand?.assigned_by?.display_name ||
                            assignment.expand?.assigned_by?.email ||
                            'Okänd'}{' '}
                          · {new Date(assignment.created).toLocaleString('sv-SE')}
                        </p>
                        {assignment.due_date ? (
                          <p className="text-xs text-foreground-subtle">
                            Deadline: {new Date(assignment.due_date).toLocaleDateString('sv-SE')}
                          </p>
                        ) : null}
                      </div>
                      <WorkshopAssignmentStatusBadge status={assignment.status} />
                    </div>
                    {takeaway.summary ? (
                      <div className="mt-3 rounded-xl border border-default bg-canvas-subtle/40 p-3 text-sm text-foreground-muted">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                          Takeaway
                        </p>
                        <p className="mt-1">{takeaway.summary}</p>
                        {takeaway.keyInsights ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-subtle">
                            <span className="font-medium text-foreground-muted">Nyckelinsikter:</span>{' '}
                            {takeaway.keyInsights}
                          </p>
                        ) : null}
                        {takeaway.prioritizedActions ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-subtle">
                            <span className="font-medium text-foreground-muted">Prioriterade actions:</span>{' '}
                            {takeaway.prioritizedActions}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}

const taskKindLabels: Record<TaskKind, string> = {
  call: 'Samtal',
  meeting: 'Möte',
  email: 'E-post',
  prep: 'Förberedelse',
  followup: 'Uppföljning',
  admin: 'Administration',
  other: 'Övrigt'
};

const taskStatusLabels: Record<TaskStatus, string> = {
  open: 'Öppen',
  in_progress: 'Pågår',
  blocked: 'Blockerad',
  done: 'Klar',
  cancelled: 'Avbruten'
};

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

function KnowledgeRow({
  label,
  signed,
  date
}: {
  label: string;
  signed?: boolean;
  date?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {date ? (
          <span className="text-xs text-foreground-subtle">
            {new Date(date).toLocaleDateString('sv-SE')}
          </span>
        ) : null}
        {signed ? (
          <span className="rounded-full bg-movexum-pastell-gron px-2.5 py-0.5 text-xs font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
            Signerat / godkänt
          </span>
        ) : (
          <span className="rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
            Ej signerat
          </span>
        )}
      </span>
    </li>
  );
}

function formatSek(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '–';
  return `${value.toLocaleString('sv-SE')} kr`;
}

function SourceBadge({ source }: { source: FinancialsSource }) {
  // Movexum-paletten: manual = neutral, import_excel = subtle muted,
  // allabolag = brand-accent (mörkblå/ljusblå), other = neutral.
  const cfg: Record<FinancialsSource, { label: string; className: string }> = {
    manual: {
      label: 'Manuell',
      className: 'bg-canvas-subtle text-foreground-muted'
    },
    import_excel: {
      label: 'Excel',
      className: 'bg-canvas-muted text-foreground-muted'
    },
    allabolag: {
      label: 'Allabolag',
      className:
        'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla'
    },
    other: {
      label: 'Övrigt',
      className: 'bg-canvas-subtle text-foreground-muted'
    }
  };
  const c = cfg[source] || cfg.other;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c.className}`}>
      {c.label}
    </span>
  );
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
