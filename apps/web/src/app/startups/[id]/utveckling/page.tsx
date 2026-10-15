import Link from 'next/link';
import { hasRole } from '@/lib/rbac';
import { WorkshopAssignmentStatusBadge } from '@/components/Badges';
import { StartupWorkCards } from '@/components/StartupWorkCards';
import { StartupPhaseHistoryList, type PhaseHistoryItem } from '@/components/StartupPhaseHistoryList';
import { IrlWorkspace } from '@/components/irl/IrlWorkspace';
import { loadIrlAssessments } from '@/lib/irl/data.server';
import {
  milestoneCategoryLabels,
  milestoneStatusLabels,
  type MilestoneCategory,
  type MilestoneStatus
} from '@/lib/labels';
import { formatStockholmDateTime, type StartupPhase } from '@platform/shared';
import { loadStartupPage } from '../_shared/context';
import { loadStartupAssignments } from '../_shared/work';
import { Empty, PillLink, Section, SectionNav, StatusPill, TabPage, formatDate } from '../_shared/ui';

interface MilestoneRecord {
  id: string;
  title: string;
  category: MilestoneCategory;
  status: MilestoneStatus;
  target_date?: string;
  achieved_at?: string;
}

interface PhaseHistoryRecord {
  id: string;
  phase: StartupPhase;
  entered_at: string;
  exited_at?: string;
  note?: string;
  expand?: { created_by?: { id: string; display_name?: string } };
}

interface IprRecord {
  id: string;
  type: string;
  status: string;
  external_reference?: string;
  filed_at?: string;
  response_at?: string;
}

const iprTypeLabels: Record<string, string> = {
  patent: 'Patent',
  utility_model: 'Nyttighetsmodell',
  trademark: 'Varumärke',
  design: 'Design',
  copyright: 'Upphovsrätt',
  trade_secret: 'Företagshemlighet',
  domain: 'Domän',
  other: 'Övrigt'
};

const iprStatusLabels: Record<string, { label: string; variant: 'success' | 'danger' | 'info' | 'neutral' }> = {
  idea: { label: 'Idé', variant: 'neutral' },
  filed: { label: 'Inlämnad', variant: 'info' },
  pending: { label: 'Under handläggning', variant: 'info' },
  granted: { label: 'Beviljad', variant: 'success' },
  rejected: { label: 'Avslagen', variant: 'danger' },
  abandoned: { label: 'Övergiven', variant: 'neutral' },
  expired: { label: 'Utgången', variant: 'neutral' }
};

/**
 * Flik "Utveckling & IRL": bolagets mognad över tid — KTH IRL (radar,
 * bedömning, historik), vad bolaget gjort och vad som väntar, milstolpar,
 * workshops med takeaways, immateriella rättigheter och fashistorik.
 */
export default async function StartupDevelopmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, startup, pb, flags } = await loadStartupPage(id);
  const byStartup = pb.filter('startup = {:startup}', { startup: id });

  const [irl, work, milestonesRes, phaseRes, iprRes] = await Promise.all([
    flags.isStaffOrObserver ? loadIrlAssessments(pb, user.tenant, id) : Promise.resolve(null),
    loadStartupAssignments(pb, user.tenant, id),
    pb
      .collection('milestones')
      .getList<MilestoneRecord>(1, 50, { filter: byStartup, sort: 'target_date' })
      .then((r) => r.items, () => null),
    pb
      .collection('startup_phase_history')
      .getList<PhaseHistoryRecord>(1, 50, { filter: byStartup, sort: '-entered_at', expand: 'created_by' })
      .then((r) => r.items, () => null),
    pb
      .collection('intellectual_property')
      .getList<IprRecord>(1, 50, {
        filter: byStartup,
        sort: '-filed_at',
        fields: 'id,type,status,external_reference,filed_at,response_at'
      })
      .then((r) => r.items, () => null)
  ]);

  const phaseItems: PhaseHistoryItem[] = (phaseRes ?? []).map((row) => ({
    id: row.id,
    phase: row.phase,
    entered_at: row.entered_at,
    exited_at: row.exited_at,
    note: row.note,
    authorLabel: row.expand?.created_by?.display_name || undefined
  }));
  const workshops = work.workshops;

  return (
    <TabPage>
      <SectionNav
        items={[
          ...(flags.isStaffOrObserver ? [{ href: '#irl', label: 'IRL' }] : []),
          { href: '#arbete', label: 'Gjort & väntar', count: work.done.length + work.pending.length },
          { href: '#milestones', label: 'Milstolpar', count: milestonesRes?.length },
          { href: '#workshops', label: 'Workshops', count: workshops.length },
          { href: '#ipr', label: 'IPR', count: iprRes?.length },
          { href: '#phase-history', label: 'Fashistorik', count: phaseRes?.length }
        ]}
      />

      {flags.isStaffOrObserver ? (
        <Section
          id="irl"
          title="KTH Innovation Readiness Level"
          description="Bolagets mognad längs sex axlar — kund, team, affär, IPR, finansiering och teknik — på skalan 1–9. Varje bedömning sparas, så utvecklingen syns över tid."
        >
          <IrlWorkspace
            startupId={id}
            assessments={irl?.assessments ?? []}
            canEdit={flags.isStaff}
            fallbackIrl={startup.irl_level}
            loadError={irl?.error}
          />
        </Section>
      ) : null}

      {work.failed ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
          Vissa tilldelningar kunde inte läsas just nu.
        </p>
      ) : null}
      <StartupWorkCards done={work.done} pending={work.pending} />

      <Section id="milestones" title="Milstolpar">
        {milestonesRes === null ? (
          <Empty>Milstolparna kunde inte läsas just nu.</Empty>
        ) : milestonesRes.length === 0 ? (
          <Empty>Inga milstolpar registrerade.</Empty>
        ) : (
          <ul className="divide-y divide-default">
            {milestonesRes.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{m.title}</p>
                  <p className="text-xs text-foreground-subtle">
                    {milestoneCategoryLabels[m.category]} ·{' '}
                    {m.status === 'achieved' && m.achieved_at
                      ? `uppnådd ${formatDate(m.achieved_at)}`
                      : m.target_date
                        ? `mål ${formatDate(m.target_date)}`
                        : 'Inget måldatum'}
                  </p>
                </div>
                <StatusPill
                  label={milestoneStatusLabels[m.status]}
                  variant={m.status === 'achieved' ? 'success' : m.status === 'missed' ? 'danger' : 'neutral'}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="workshops"
        title="Workshops"
        description="Tilldelade workshops och takeaways som sparats på bolagskortet."
        action={flags.isStaff ? <PillLink href="/education">Hantera workshops</PillLink> : null}
      >
        {workshops.length === 0 ? (
          <Empty>Inga workshoptilldelningar än.</Empty>
        ) : (
          <ul className="space-y-3">
            {workshops.map((assignment) => {
              const takeaway = assignment.takeaway_json || {};
              return (
                <li key={assignment.id} className="rounded-2xl border border-default p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        <Link href={`/education/assignments/${assignment.id}`} className="hover:text-brand hover:underline">
                          {assignment.expand?.workshop?.title || 'Workshop'}
                        </Link>
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        Tilldelad av {assignment.expand?.assigned_by?.display_name || 'okänd'} · {formatDate(assignment.created)}
                        {assignment.due_date ? ` · deadline ${formatDate(assignment.due_date)}` : ''}
                      </p>
                      {assignment.instructions ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground-muted">{assignment.instructions}</p>
                      ) : null}
                      {assignment.expand?.meeting ? (
                        <p className="mt-1 text-xs text-foreground-subtle">
                          Möte: {assignment.expand.meeting.name} · {formatStockholmDateTime(assignment.expand.meeting.starts_at)}
                        </p>
                      ) : null}
                    </div>
                    <WorkshopAssignmentStatusBadge status={assignment.status} />
                  </div>
                  {takeaway.summary ? (
                    <div className="mt-3 rounded-xl border border-default bg-canvas-subtle/40 p-3 text-sm text-foreground-muted">
                      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Takeaway</p>
                      <p className="mt-1">{takeaway.summary}</p>
                      {takeaway.keyInsights ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-subtle">
                          <span className="font-medium text-foreground-muted">Nyckelinsikter:</span> {takeaway.keyInsights}
                        </p>
                      ) : null}
                      {takeaway.prioritizedActions ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-subtle">
                          <span className="font-medium text-foreground-muted">Prioriterade åtgärder:</span>{' '}
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

      <Section
        id="ipr"
        title="Immateriella rättigheter"
        description="Patent, varumärken, design m.m. — underlag för IRL-axeln IPR."
        action={<PillLink href={`/toolbox?startup=${id}&category=template`}>IPR-verktyg</PillLink>}
      >
        {iprRes === null ? (
          <Empty>Rättigheterna kunde inte läsas just nu.</Empty>
        ) : iprRes.length === 0 ? (
          <Empty>Inga immateriella rättigheter registrerade.</Empty>
        ) : (
          <ul className="divide-y divide-default">
            {iprRes.map((r) => {
              const st = iprStatusLabels[r.status] ?? { label: r.status, variant: 'neutral' as const };
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {iprTypeLabels[r.type] ?? r.type}
                      {r.external_reference ? (
                        <span className="ml-2 text-xs font-normal text-foreground-subtle mx-tnum">{r.external_reference}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-foreground-subtle">
                      {r.filed_at ? `Inlämnad ${formatDate(r.filed_at)}` : 'Ej inlämnad'}
                      {r.response_at ? ` · svar ${formatDate(r.response_at)}` : ''}
                    </p>
                  </div>
                  <StatusPill label={st.label} variant={st.variant} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="phase-history" title="Fashistorik">
        {phaseRes === null ? (
          <Empty>Fashistoriken kunde inte läsas just nu.</Empty>
        ) : (
          <StartupPhaseHistoryList
            startupId={id}
            items={phaseItems}
            canEdit={flags.canEdit}
            canDelete={hasRole(user.roles, ['admin'])}
          />
        )}
      </Section>
    </TabPage>
  );
}
