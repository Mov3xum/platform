import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import {
  criteriaOfType,
  eligibilityChecks,
  getApplication,
  getCheckType,
  listComments,
  listDocuments,
  listRevisions,
  loadEligibilityContext,
  todayKey
} from '@/lib/support-checks/data';
import { getFundingProject, listWorkPackages } from '@/lib/funding/data';
import { loadFundingOptions } from '../form-data';
import {
  DEFAULT_SUPPORT_CHECK_CRITERIA,
  EDITABLE_SUPPORT_CHECK_STATUSES,
  FUNDING_BASIS_LABELS,
  canTransitionSupportCheck,
  formatStockholmDateTime,
  grantedAmount,
  supportCheckNextStep,
  supportCheckPhase,
  workPackageLabel,
  type Role,
  type SupportCheckRevisionSnapshot
} from '@platform/shared';
import { ApplicantPanel } from './ApplicantPanel';
import { CommentsPanel, type CommentView } from './CommentsPanel';
import { DocumentsPanel, type DocView } from './DocumentsPanel';
import { ReviewPanel } from './ReviewPanel';
import { BackLink, BasisChip, EligibilityChip, ExcellenceChip, Fact, Notice, Panel, PhaseChip, StatusChip, btnGhost, fmtDate, fmtSek } from '../ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

interface TaskRow {
  id: string;
  description: string;
  status: string;
  due_at?: string;
  rule_key?: string;
  expand?: { owner?: { display_name?: string; email?: string } };
}

const WHO_LABEL: Record<string, string> = { applicant: 'bolaget', coach: 'coachen', controller: 'controllern', lead: 'ledningen', none: '' };

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const app = await getApplication(pb, user.tenant, id);
  if (!app) notFound();
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isReader = hasRole(user.roles, READ_ROLES);
  const isLead = hasRole(user.roles, LEAD_ROLES);
  const isMember = user.linkedStartups.includes(app.startup);
  if (!isReader && !isMember) redirect('/checkar');
  const today = todayKey();

  const [type, revisions, comments, documents, funding] = await Promise.all([
    getCheckType(pb, user.tenant, app.check_type),
    listRevisions(pb, user.tenant, app.id),
    listComments(pb, user.tenant, app.id),
    listDocuments(pb, user.tenant, app.id),
    isLead ? loadFundingOptions(pb, user.tenant) : Promise.resolve({ projects: [], workPackages: [] })
  ]);
  const ctx = await loadEligibilityContext(pb, user.tenant, app.startup, type);
  const checks = type ? eligibilityChecks(type, ctx, app) : [];
  const phase = supportCheckPhase(app, type, today);
  const next = supportCheckNextStep(app, phase);
  const criteria = type ? criteriaOfType(type) : [];
  const usableCriteria = criteria.length ? criteria : DEFAULT_SUPPORT_CHECK_CRITERIA.map((c) => ({ ...c }));
  const latest = revisions[0] ?? null;
  const snapshot = latest ? (latest.snapshot as SupportCheckRevisionSnapshot) : null;
  const granted = grantedAmount(app);

  const [project, wps, tasksRes] = await Promise.all([
    app.funding_project && isReader ? getFundingProject(pb, user.tenant, app.funding_project) : Promise.resolve(null),
    app.funding_project && isReader ? listWorkPackages(pb, user.tenant, app.funding_project) : Promise.resolve([]),
    isReader
      ? pb
          .collection('tasks')
          .getList<TaskRow>(1, 100, { filter: pb.filter('tenant = {:t} && support_check_application = {:a} && status != "cancelled"', { t: user.tenant, a: app.id }), sort: 'due_at', expand: 'owner' })
          .catch(() => ({ items: [] as TaskRow[] }))
      : Promise.resolve({ items: [] as TaskRow[] })
  ]);
  const wp = wps.find((w) => w.id === app.funding_work_package) ?? null;
  const openTasks = tasksRes.items.filter((t) => t.status !== 'done');

  const role = isLead ? 'lead' : isStaff ? 'staff' : isMember ? 'applicant' : null;
  const canEdit = role !== null && EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status);
  const canSubmit = role !== null && canTransitionSupportCheck(app.status, 'submitted', role);
  const canWithdraw = role !== null && role !== 'lead' && canTransitionSupportCheck(app.status, 'withdrawn', role);
  const canReport = app.status === 'paid' && !app.final_report_received_at && (isMember || isStaff) && type?.requires_final_report !== false;
  const canUpload = isStaff || (isMember && (EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status) || app.status === 'paid'));
  const openIssues = comments.filter((c) => !c.resolved_at && c.visible_to_applicant).length;

  const commentViews: CommentView[] = comments.map((c) => ({
    id: c.id,
    authorName: c.expand?.author?.display_name || c.expand?.author?.email?.split('@')[0] || 'Användare',
    section: c.section,
    body: c.body,
    visibleToApplicant: Boolean(c.visible_to_applicant),
    revision: Number(c.revision ?? 0),
    resolved: Boolean(c.resolved_at),
    createdAt: (c.created ?? '').slice(0, 10),
    mine: c.author === user.id
  }));
  const docViews: DocView[] = documents.map((d) => ({
    id: d.id,
    title: d.title ?? null,
    filename: d.filename || 'fil',
    kind: d.kind,
    url: `/api/checkar/documents/${d.id}/file`,
    sizeBytes: d.size_bytes ?? null,
    created: (d.created ?? '').slice(0, 10),
    canDelete: isStaff || (isMember && d.uploaded_by === user.id && (EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status) || app.status === 'paid'))
  }));

  return (
    <PageShell
      title={app.title || type?.title || 'Ansökan'}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <PhaseChip phase={phase} />
          <StatusChip status={app.status} />
          {(app.is_excellence_activity ?? type?.is_excellence_activity) && <ExcellenceChip />}
          {isReader && <BasisChip basis={app.state_aid_basis} />}
        </span>
      }
      actions={
        <>
          <BackLink href={isReader ? '/checkar' : '/min-oversikt'} label={isReader ? 'Alla ansökningar' : 'Min översikt'} />
          <a href={`/api/checkar/${app.id}/pdf`} target="_blank" rel="noopener noreferrer" className={btnGhost}>
            <Icon name="download" size={12} /> PDF
          </a>
        </>
      }
    >
      <div className="space-y-5">
        {next.who !== 'none' && (
          <Notice kind={next.who === 'applicant' ? 'warning' : 'notice'}>
            <span className="font-semibold">Nästa steg:</span> {next.label} <span className="text-xs">(väntar på {WHO_LABEL[next.who]})</span>
            {app.status === 'changes_requested' && app.changes_due_at && <span className="text-xs"> · svar senast {app.changes_due_at}</span>}
          </Notice>
        )}
        {app.status === 'changes_requested' && app.changes_request_note && (
          <Notice kind="warning">
            <span className="font-semibold">Begärd komplettering:</span> {app.changes_request_note}
          </Notice>
        )}
        {app.status === 'rejected' && app.decision_note && (
          <Notice kind="error">
            <span className="font-semibold">Beslut:</span> {app.decision_note}
          </Notice>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="space-y-5">
            <Panel title="Ansökan" meta={<span className="text-xs text-foreground-subtle">{type?.title ?? 'Stödcheck'} · version {app.revision ?? 0}</span>}>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fact
                  label="Bolag"
                  value={
                    isReader ? (
                      <Link href={`/startups/${app.startup}#stodcheckar`} className="hover:underline">
                        {app.startup_name || 'Bolag'}
                      </Link>
                    ) : (
                      app.startup_name || 'Bolag'
                    )
                  }
                />
                <Fact label="Sökt belopp" value={fmtSek(app.requested_amount_sek)} />
                {granted > 0 && <Fact label="Beviljat" value={fmtSek(granted)} />}
                {app.paid_at && <Fact label="Utbetalt" value={`${fmtSek(app.paid_amount_sek ?? granted)} · ${fmtDate(app.paid_at)}`} />}
                <Fact label="Inskickad" value={fmtDate(app.submitted_at)} />
                <Fact label="Planerat slut" value={fmtDate(app.activity_end_date)} />
                {app.report_due_at && <Fact label="Slutrapport senast" value={app.final_report_received_at ? `mottagen ${fmtDate(app.final_report_received_at)}` : fmtDate(app.report_due_at)} />}
              </dl>
              {checks.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {checks.map((c) => (
                    <EligibilityChip key={c.key} check={c} />
                  ))}
                </div>
              )}
              {app.applicant_note && <p className="mt-4 whitespace-pre-line rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">{app.applicant_note}</p>}
            </Panel>

            <Panel title="Insatser i prioriteringsordning" meta={<span className="text-xs text-foreground-subtle">{app.activities.length} st</span>}>
              {app.activities.length === 0 ? (
                <p className="text-sm text-foreground-subtle">Inga insatser beskrivna än.</p>
              ) : (
                <ol className="space-y-4">
                  {app.activities.map((a, i) => (
                    <li key={a.id} className="rounded-2xl border border-default p-4 text-sm">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-brand-foreground">Insats {i + 1}</span>
                        <span className="font-semibold text-foreground">{a.title || 'utan rubrik'}</span>
                        <span className="flex-1" />
                        <span className="text-foreground-muted mx-tnum">{fmtSek(a.cost_sek)}</span>
                        {a.ends_at && <span className="text-xs text-foreground-subtle mx-tnum">slut {a.ends_at}</span>}
                      </div>
                      <p className="whitespace-pre-line text-foreground-muted">{a.description}</p>
                      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        <Fact label="Medverkar från bolaget" value={a.participants || '–'} />
                        <Fact label="Spetskompetens" value={a.expert_need || 'Inget behov angivet'} />
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel title="Handlingar" id="handlingar">
              <ApplicantPanel
                applicationId={app.id}
                status={app.status}
                canEdit={canEdit}
                canSubmit={canSubmit}
                canWithdraw={canWithdraw}
                canReport={canReport && isMember && !isStaff}
                isApplicant={role === 'applicant'}
                requestedSek={app.requested_amount_sek ?? null}
                activityCount={app.activities.length}
                openIssues={openIssues}
              />
            </Panel>

            {isStaff && (
              <Panel title="Movexums handläggning">
                <ReviewPanel
                  applicationId={app.id}
                  state={{
                    status: app.status,
                    coachStatement: app.coach_statement ?? '',
                    coachStatementAt: app.coach_statement_at ?? null,
                    controllerStatement: app.controller_statement ?? '',
                    controllerStatementAt: app.controller_statement_at ?? null,
                    scores: (app.assessment_scores && typeof app.assessment_scores === 'object' ? app.assessment_scores : {}) as Record<string, number>,
                    score: app.assessment_score ?? null,
                    fundingProject: app.funding_project ?? null,
                    fundingWorkPackage: app.funding_work_package ?? null,
                    stateAidBasis: app.state_aid_basis ?? null,
                    fundingNote: app.funding_note ?? '',
                    requestedSek: app.requested_amount_sek ?? null,
                    approvedSek: app.approved_amount_sek ?? null,
                    decisionNote: app.decision_note ?? '',
                    paidAt: app.paid_at ?? null,
                    finalReportAt: app.final_report_received_at ?? null,
                    openIssues,
                    hasArt22Period: ctx.hasArt22Period
                  }}
                  criteria={usableCriteria}
                  funding={funding}
                  isLead={isLead}
                  defaultBasis={type?.default_state_aid_basis ?? null}
                  defaultProject={type?.funding_project ?? null}
                  defaultWorkPackage={type?.default_work_package ?? null}
                />
              </Panel>
            )}

            {!isStaff && isReader && (app.coach_statement || app.controller_statement || app.decision_note) && (
              <Panel title="Movexums handläggning">
                <dl className="space-y-3 text-sm">
                  {app.coach_statement && <Fact label={`Coachens utlåtande (${fmtDate(app.coach_statement_at)})`} value={<span className="whitespace-pre-line">{app.coach_statement}</span>} />}
                  {app.controller_statement && <Fact label={`Controllerns utlåtande (${fmtDate(app.controller_statement_at)})`} value={<span className="whitespace-pre-line">{app.controller_statement}</span>} />}
                  {app.decision_note && <Fact label={`Beslut (${fmtDate(app.decided_at)})`} value={app.decision_note} />}
                </dl>
              </Panel>
            )}
          </div>

          <div className="space-y-5">
            {isReader && (
              <Panel title="Finansiering">
                {app.funding_project ? (
                  <dl className="space-y-2 text-sm">
                    <Fact
                      label="Projekt"
                      value={
                        <Link href={`/projekt/${app.funding_project}`} className="hover:underline">
                          {project?.title ?? 'Projekt'}
                        </Link>
                      }
                    />
                    <Fact label="Arbetspaket" value={wp ? workPackageLabel(wp) : '–'} />
                    <Fact label="Statsstödsgrund" value={app.state_aid_basis ? FUNDING_BASIS_LABELS[app.state_aid_basis] : '–'} />
                    {app.funding_note && <Fact label="Anteckning" value={app.funding_note} />}
                    {app.de_minimis_stod && (
                      <Fact
                        label="De minimis-post"
                        value={
                          <Link href={`/de-minimis/${app.startup}`} className="text-link hover:underline">
                            Registrerad
                          </Link>
                        }
                      />
                    )}
                    {app.capital_round && (
                      <Fact
                        label="Kapitalrad"
                        value={
                          <Link href={`/startups/${app.startup}#partners`} className="text-link hover:underline">
                            Registrerad
                          </Link>
                        }
                      />
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-foreground-subtle">Inte satt än. {isLead ? 'Sätt projekt, arbetspaket och statsstödsgrund i handläggningen innan beslut.' : 'Sätts av ledningen inför beslut.'}</p>
                )}
                {isStaff && app.assessment_score !== null && app.assessment_score !== undefined && (
                  <p className="mt-3 text-xs text-foreground-subtle mx-tnum">Bedömning: {app.assessment_score.toFixed(1)} / 5</p>
                )}
              </Panel>
            )}

            <Panel title="Signering & versioner">
              {revisions.length === 0 ? (
                <p className="text-sm text-foreground-subtle">Inte signerad än.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {revisions.map((r) => (
                    <li key={r.id} className="rounded-xl border border-default p-3">
                      <div className="font-medium text-foreground">Version {r.revision} · {r.signer_name}</div>
                      <div className="text-xs text-foreground-subtle">{formatStockholmDateTime(r.signed_at)} · AES</div>
                      <div className="mt-1 break-all font-mono text-[10px] text-foreground-subtle">{r.document_hash}</div>
                    </li>
                  ))}
                </ul>
              )}
              {snapshot && snapshot.revision !== (app.revision ?? 0) && <p className="mt-2 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">Ansökan har ändrats efter senaste signeringen.</p>}
            </Panel>

            <Panel title="Kommentarer & kompletteringar" id="kommentarer">
              <CommentsPanel applicationId={app.id} comments={commentViews} isStaff={isStaff} canComment={isStaff || isMember} currentRevision={app.revision ?? 0} />
            </Panel>

            <Panel title="Bilagor">
              <DocumentsPanel applicationId={app.id} documents={docViews} canUpload={canUpload} allowReportKinds={app.status === 'paid'} />
            </Panel>

            {isReader && (
              <Panel title="Uppföljningar" meta={<span className="text-xs text-foreground-subtle">{openTasks.length} öppna</span>}>
                {openTasks.length === 0 ? (
                  <p className="text-sm text-foreground-subtle">Inga öppna uppföljningar.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {openTasks.map((t) => {
                      const overdue = t.due_at && t.due_at.slice(0, 10) < today;
                      return (
                        <li key={t.id} className="rounded-xl border border-default p-3">
                          <div className="text-foreground">{t.description}</div>
                          <div className="mt-1 text-xs text-foreground-subtle mx-tnum">
                            <span className={overdue ? 'font-semibold text-movexum-morkorange dark:text-movexum-pastell-orange' : ''}>{t.due_at ? `Senast ${t.due_at.slice(0, 10)}` : 'Utan datum'}</span>
                            {t.expand?.owner && <span> · {t.expand.owner.display_name || t.expand.owner.email?.split('@')[0]}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
