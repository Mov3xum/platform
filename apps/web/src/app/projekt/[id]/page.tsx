import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { deleteFundingProjectFormAction } from '@/lib/actions/funding';
import { buildProjectOverview, getFundingProject, listFundingLedger, listWorkPackages } from '@/lib/funding/data';
import { listCheckTypes, typesById } from '@/lib/support-checks/data';
import { FUNDING_BASIS_LABELS, FUNDING_BASIS_SHORT, FUNDING_PROJECT_KIND_LABELS, FUNDING_PROJECT_STATUS_LABELS, workPackageLabel, type Role } from '@platform/shared';
import { WorkPackagesPanel, type WorkPackageView } from './WorkPackagesPanel';
import { BackLink, Fact, KpiRow, Panel, btnGhost, fmtDate, fmtSek } from '@/app/checkar/ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function ProjektDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'projekt', user.enabledModules)) redirect('/hem');
  const canManage = hasRole(user.roles, LEAD_ROLES);
  const pb = await getServerPb();
  const project = await getFundingProject(pb, user.tenant, id);
  if (!project) notFound();
  const [wps, ledger, types] = await Promise.all([listWorkPackages(pb, user.tenant, project.id), listFundingLedger(pb, user.tenant, project.id), listCheckTypes(pb, user.tenant)]);
  const byType = typesById(types);
  const overview = buildProjectOverview(project, wps, ledger);
  const wpName = new Map(wps.map((w) => [w.id, workPackageLabel(w)]));
  const wpViews: WorkPackageView[] = overview.workPackages.map(({ wp, burn, count }) => ({
    id: wp.id,
    code: wp.code ?? '',
    title: wp.title,
    description: wp.description ?? '',
    budgetSek: wp.budget_sek ?? null,
    startsAt: wp.starts_at ?? '',
    endsAt: wp.ends_at ?? '',
    grantedSek: burn.grantedSek,
    paidSek: burn.paidSek,
    count,
    signal: burn.signal
  }));

  return (
    <PageShell
      title={project.title}
      meta={
        <span className="text-sm text-foreground-subtle">
          {FUNDING_PROJECT_KIND_LABELS[project.kind]} · {FUNDING_PROJECT_STATUS_LABELS[project.status]}
        </span>
      }
      actions={
        <>
          <BackLink href="/projekt" label="Alla projekt" />
          {canManage && (
            <Link href={`/projekt/${project.id}/redigera`} className={btnGhost}>
              <Icon name="pencil" size={12} /> Redigera
            </Link>
          )}
          {canManage && (
            <ConfirmDeleteButton action={deleteFundingProjectFormAction} hiddenField={{ name: 'project_id', value: project.id }} label="Radera" variant="ghost" description={`Radera "${project.title}" med alla arbetspaket? Går bara om inga stödcheckar beviljats ur projektet.`} />
          )}
        </>
      }
    >
      <div className="space-y-5">
        <KpiRow
          items={[
            { label: 'Budget', value: fmtSek(overview.burn.budgetSek) },
            { label: 'Beviljat', value: fmtSek(overview.burn.grantedSek), hint: overview.burn.pctGranted !== null ? `${overview.burn.pctGranted} % av budget` : undefined },
            { label: 'Utbetalt', value: fmtSek(overview.burn.paidSek) },
            { label: 'Kvar', value: fmtSek(overview.burn.remainingSek), hint: overview.burn.pctElapsed !== null ? `${overview.burn.pctElapsed} % av perioden passerad` : undefined }
          ]}
        />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-5">
            <Panel title="Arbetspaket" meta={<span className="text-xs text-foreground-subtle">{wps.length} st</span>}>
              <WorkPackagesPanel projectId={project.id} items={wpViews} canManage={canManage} />
            </Panel>
            <Panel title="Kassabok — beviljade stödcheckar" meta={<span className="text-xs text-foreground-subtle">{ledger.length} st</span>}>
              {ledger.length === 0 ? (
                <p className="text-sm text-foreground-subtle">Inga beviljade checkar ur projektet än.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-foreground-subtle">
                      <tr>
                        <th className="px-2 py-2">Bolag</th>
                        <th className="px-2 py-2">Check</th>
                        <th className="px-2 py-2">Arbetspaket</th>
                        <th className="px-2 py-2">Stödgrund</th>
                        <th className="px-2 py-2">Beslut</th>
                        <th className="px-2 py-2">Beviljat</th>
                        <th className="px-2 py-2">Utbetalt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((r) => (
                        <tr key={r.id} className="border-t border-default">
                          <td className="px-2 py-2">
                            <Link href={`/startups/${r.startup}#stodcheckar`} className="text-foreground hover:underline">
                              {r.startup_name || 'Bolag'}
                            </Link>
                          </td>
                          <td className="px-2 py-2">
                            <Link href={`/checkar/${r.id}`} className="text-foreground-muted hover:underline">
                              {byType.get(r.check_type)?.title ?? 'Stödcheck'}
                              {r.title ? ` — ${r.title}` : ''}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-foreground-muted">{r.work_package ? wpName.get(r.work_package) ?? '–' : '–'}</td>
                          <td className="px-2 py-2 text-foreground-muted">{r.state_aid_basis ? FUNDING_BASIS_SHORT[r.state_aid_basis as keyof typeof FUNDING_BASIS_SHORT] ?? r.state_aid_basis : '–'}</td>
                          <td className="px-2 py-2 text-foreground-muted mx-tnum">{fmtDate(r.decided_at)}</td>
                          <td className="px-2 py-2 text-foreground-muted mx-tnum">{fmtSek(r.granted_sek)}</td>
                          <td className="px-2 py-2 text-foreground-muted mx-tnum">{r.paid_at ? fmtSek(r.paid_sek ?? r.granted_sek) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-foreground-subtle">Underlag för rekvisition per arbetspaket: bolag, belopp, datum och stödgrund. Ansökan är sanningen — beloppen här är inga kopior.</p>
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Om projektet">
              <dl className="space-y-2 text-sm">
                <Fact label="Finansiär" value={project.funder || FUNDING_PROJECT_KIND_LABELS[project.kind]} />
                <Fact label="Diarienummer" value={project.diarienummer || '–'} />
                <Fact label="Period" value={`${fmtDate(project.starts_at)} – ${fmtDate(project.ends_at)}`} />
                <Fact label="Default statsstödsgrund" value={project.default_state_aid_basis ? FUNDING_BASIS_LABELS[project.default_state_aid_basis] : '–'} />
                <Fact label="Stödgivare på de minimis-poster" value={project.default_stodgivare || 'Movexum (projektets titel)'} />
              </dl>
              {project.description && <p className="mt-3 whitespace-pre-line text-sm text-foreground-muted">{project.description}</p>}
            </Panel>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
