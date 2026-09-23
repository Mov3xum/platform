import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { pbFileUrl } from '@/lib/pb-file';
import { deleteProcurementFormAction } from '@/lib/actions/procurements';
import {
  criteriaOf,
  getProcurement,
  listCalloffs,
  listProcurementDocuments,
  listProcurementRules,
  templateOf,
  todayKey,
  DOCUMENTS
} from '@/lib/procurements/data';
import {
  PROCUREMENT_PROCEDURE_LABELS,
  PROCUREMENT_RULE_ANCHOR_LABELS,
  aggregateProcurementScore,
  calloffAlerts,
  calloffPhase,
  type ProcurementProcedure,
  type Role
} from '@platform/shared';
import { CalloffsPanel, type CalloffView } from './CalloffsPanel';
import { DocumentsPanel, type ProcurementDocView } from './DocumentsPanel';
import { SyncButton } from './SyncButton';
import { loadFormOptions } from '../form-data';
import { AlertChip, BackLink, ExcellenceChip, Notice, Panel, StatusChip, btnGhost, fmtDate, fmtSek } from '../ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const DELETE_ROLES: Role[] = ['admin', 'incubator_lead'];

interface TaskRow {
  id: string;
  description: string;
  status: string;
  due_at?: string;
  kind?: string;
  startup?: string;
  procurement_calloff?: string;
  rule_key?: string;
  expand?: { owner?: { display_name?: string; email?: string }; startup?: { name?: string } };
}

const TASK_STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlogg',
  open: 'Att göra',
  in_progress: 'Pågår',
  review: 'Granskas',
  blocked: 'Blockerad',
  done: 'Klar',
  cancelled: 'Avbruten'
};

export default async function UpphandlingPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'upphandlingar', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const p = await getProcurement(pb, user.tenant, id);
  if (!p) notFound();
  const canEdit = hasRole(user.roles, STAFF_ROLES);
  const canDelete = hasRole(user.roles, DELETE_ROLES);
  const today = todayKey();

  const [calloffs, docs, rules, options, tasksRes] = await Promise.all([
    listCalloffs(pb, user.tenant, { procurementId: p.id }),
    listProcurementDocuments(pb, user.tenant, p.id),
    listProcurementRules(pb, user.tenant),
    canEdit ? loadFormOptions(pb, user.tenant) : Promise.resolve({ people: [], agreements: [], startups: [] }),
    pb
      .collection('tasks')
      .getList<TaskRow>(1, 200, {
        filter: pb.filter('tenant = {:t} && procurement = {:p} && status != "cancelled"', { t: user.tenant, p: p.id }),
        sort: 'due_at',
        expand: 'owner,startup'
      })
      .catch(() => ({ items: [] as TaskRow[] }))
  ]);

  const criteria = criteriaOf(p);
  const template = templateOf(p);
  const ownRules = rules.filter((r) => r.procurement === p.id);
  const globalRules = rules.filter((r) => !r.procurement && r.active);
  const agg = aggregateProcurementScore(calloffs);
  const views: CalloffView[] = calloffs.map((c) => ({
    id: c.id,
    title: c.title ?? '',
    startupId: c.startup ?? null,
    startupName: c.startup_name ?? null,
    status: c.status,
    phase: calloffPhase(c, today),
    alerts: calloffAlerts(c, today),
    started_at: c.started_at ?? null,
    ends_at: c.ends_at ?? null,
    milestone_1_due: c.milestone_1_due ?? null,
    milestone_1_approved_at: c.milestone_1_approved_at ?? null,
    milestone_2_due: c.milestone_2_due ?? null,
    milestone_2_approved_at: c.milestone_2_approved_at ?? null,
    final_report_received_at: c.final_report_received_at ?? null,
    amount_sek: typeof c.amount_sek === 'number' ? c.amount_sek : null,
    movexum_share_pct: typeof c.movexum_share_pct === 'number' ? c.movexum_share_pct : null,
    state_aid_relevant: Boolean(c.state_aid_relevant),
    is_excellence_activity: Boolean(c.is_excellence_activity),
    evaluation_scores: (c.evaluation_scores && typeof c.evaluation_scores === 'object' ? c.evaluation_scores : {}) as Record<string, number>,
    evaluation_score: c.evaluation_score ?? null,
    evaluation_summary: c.evaluation_summary ?? '',
    evaluated_at: c.evaluated_at ?? null,
    notes: c.notes ?? ''
  }));
  const totalAlerts = views.reduce((a, v) => a + v.alerts.length, 0);
  const docViews: ProcurementDocView[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    filename: d.filename || 'dokument',
    url: pbFileUrl(DOCUMENTS, d.id, d.file),
    sizeBytes: d.size_bytes,
    analyzed: Boolean(d.analyzed_at),
    created: d.created
  }));
  const openTasks = tasksRes.items.filter((t) => t.status !== 'done');
  const doneTasks = tasksRes.items.filter((t) => t.status === 'done');
  const notice = typeof sp.notice === 'string' ? sp.notice : null;
  const warning = typeof sp.warning === 'string' ? sp.warning : null;

  return (
    <PageShell
      title={p.title}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip status={p.status as never} />
          {p.is_excellence_activity && <ExcellenceChip />}
          {totalAlerts > 0 && <AlertChip label={`${totalAlerts} avvikelser`} />}
        </span>
      }
      actions={
        <>
          <BackLink href="/upphandlingar" label="Alla" />
          {canEdit && (
            <>
              <SyncButton procurementId={p.id} />
              <Link href={`/upphandlingar/${p.id}/redigera`} className={btnGhost}>
                <Icon name="pencil" size={12} /> Redigera
              </Link>
            </>
          )}
          {canDelete && (
            <ConfirmDeleteButton
              action={deleteProcurementFormAction}
              hiddenField={{ name: 'procurement_id', value: p.id }}
              label="Radera"
              variant="ghost"
              description={`Radera "${p.title}" med alla avrop, regler, dokument och genererade uppföljningar? Detta går inte att ångra.`}
            />
          )}
        </>
      }
    >
      <div className="space-y-5">
        {notice && <Notice kind="notice">{notice}</Notice>}
        {warning && <Notice kind="warning">{warning}</Notice>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-5">
            <Panel title="Om upphandlingen">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fact label="Leverantör" value={p.supplier || '– (inte tilldelad)'} />
                <Fact label="Förfarande" value={p.procedure ? PROCUREMENT_PROCEDURE_LABELS[p.procedure as ProcurementProcedure] : '–'} />
                <Fact label="Diarienummer" value={p.diarienummer || '–'} />
                <Fact label="Sista anbudsdag" value={fmtDate(p.tender_deadline)} />
                <Fact label="Avtalstid" value={`${fmtDate(p.contract_start)} – ${fmtDate(p.contract_end)}${p.extension_option_months ? ` (+${p.extension_option_months} mån option)` : ''}`} />
                <Fact label="Uppskattat värde" value={fmtSek(p.estimated_value_sek)} />
                <Fact label="Uppskattat antal avrop" value={p.estimated_calloffs ?? '–'} />
                <Fact label="Leverantörsbetyg" value={agg.score === null ? 'inga utvärderingar än' : `${agg.score.toFixed(1)} / 5 (${agg.evaluated} avrop)`} />
              </dl>
              {p.description && <p className="mt-4 whitespace-pre-line text-sm text-foreground-muted">{p.description}</p>}
              {p.notes && (
                <p className="mt-3 rounded-xl bg-canvas-subtle p-3 text-xs text-foreground-muted">
                  <span className="font-semibold">Interna anteckningar:</span> {p.notes}
                </p>
              )}
            </Panel>

            <Panel
              title="Avrop per bolag"
              meta={<span className="text-sm text-foreground-subtle">{calloffs.length} st</span>}
            >
              <CalloffsPanel
                procurementId={p.id}
                calloffs={views}
                startups={options.startups}
                criteria={criteria}
                template={template}
                canEdit={canEdit}
              />
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel
              title="Uppföljningar"
              meta={<span className="text-sm text-foreground-subtle">{openTasks.length} öppna</span>}
            >
              <p className="mb-3 text-xs text-foreground-muted">
                Genereras automatiskt av reglerna och stängs när villkoret upphör (t.ex. när milstolpen godkänns).
                Syns även på bolagens tavlor och i din översikt.
              </p>
              {openTasks.length === 0 ? (
                <p className="text-sm text-foreground-subtle">Inga öppna uppföljningar.</p>
              ) : (
                <ul className="space-y-2">
                  {openTasks.map((t) => {
                    const overdue = t.due_at && t.due_at.slice(0, 10) < today;
                    return (
                      <li key={t.id} className="rounded-xl border border-default p-3 text-sm">
                        <div className="text-foreground">{t.description}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-foreground-subtle mx-tnum">
                          <span className={overdue ? 'font-semibold text-movexum-morkorange' : ''}>
                            {t.due_at ? `Senast ${t.due_at.slice(0, 10)}` : 'Utan datum'}
                          </span>
                          <span>· {TASK_STATUS_LABEL[t.status] ?? t.status}</span>
                          {t.expand?.owner && <span>· {t.expand.owner.display_name || t.expand.owner.email?.split('@')[0]}</span>}
                          {t.startup && (
                            <Link href={`/startups/${t.startup}/aktiviteter`} className="text-link hover:underline">
                              · {t.expand?.startup?.name ?? 'bolagets tavla'}
                            </Link>
                          )}
                          {!t.rule_key && <span>· manuell</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {doneTasks.length > 0 && (
                <p className="mt-3 text-xs text-foreground-subtle">{doneTasks.length} klara/auto-stängda uppföljningar.</p>
              )}
            </Panel>

            <Panel
              title="Regler som gäller"
              actions={
                <Link href={`/upphandlingar/regler?procurement=${p.id}`} className="text-xs text-link hover:underline">
                  Hantera
                </Link>
              }
            >
              <ul className="space-y-1 text-xs text-foreground-muted">
                {ownRules.map((r) => (
                  <li key={r.id} className={r.active ? '' : 'line-through opacity-60'}>
                    <span className="font-semibold text-foreground">{r.name}</span> — {PROCUREMENT_RULE_ANCHOR_LABELS[r.anchor]}{' '}
                    {r.offset_days >= 0 ? `+${r.offset_days}` : r.offset_days} d <span className="text-foreground-subtle">(bara denna)</span>
                  </li>
                ))}
                {globalRules.map((r) => (
                  <li key={r.id}>
                    <span className="font-semibold text-foreground">{r.name}</span> — {PROCUREMENT_RULE_ANCHOR_LABELS[r.anchor]}{' '}
                    {r.offset_days >= 0 ? `+${r.offset_days}` : r.offset_days} d
                  </li>
                ))}
                {ownRules.length + globalRules.length === 0 && <li>Inga aktiva regler.</li>}
              </ul>
            </Panel>

            <Panel title="Underlag">
              <DocumentsPanel procurementId={p.id} documents={docViews} canManage={canEdit} />
            </Panel>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground-subtle">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
