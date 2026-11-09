import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { listApplications, listCheckTypes, todayKey, typesById } from '@/lib/support-checks/data';
import { syncAllSupportCheckFollowups } from '@/lib/support-checks/followups';
import { listFundingProjects } from '@/lib/funding/data';
import {
  SUPPORT_CHECK_STATUSES,
  SUPPORT_CHECK_STATUS_LABELS,
  grantedAmount,
  isPureStartupMember,
  isSupportCheckStatus,
  summarizeSupportChecks,
  supportCheckNextStep,
  supportCheckPhase,
  type Role
} from '@platform/shared';
import { BasisChip, KpiRow, Notice, PhaseChip, btnGhost, btnPrimary, fmtDate, fmtSek } from './ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

const WHO_LABEL: Record<string, string> = { applicant: 'Bolaget', coach: 'Coach', controller: 'Controller', lead: 'Ledning', none: '' };

export default async function CheckarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const isMember = isPureStartupMember(user.roles);
  if (!isMember && !canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  if (isMember && user.linkedStartups.length === 0) redirect('/min-oversikt');
  const sp = await searchParams;
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const canManage = hasRole(user.roles, LEAD_ROLES);
  const today = todayKey();

  // Lazy synk (§ 46.6): reglerna tickar mot klockan även om ingen rört ärendet.
  let syncWarning: string | null = null;
  if (isStaff) {
    const results = await syncAllSupportCheckFollowups(pb, { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles }).catch(() => []);
    syncWarning = results.find((r) => r.error)?.error ?? null;
  }

  const statusFilter = typeof sp.status === 'string' && isSupportCheckStatus(sp.status) ? sp.status : null;
  const typeFilter = typeof sp.typ === 'string' ? sp.typ : null;
  const projectFilter = typeof sp.projekt === 'string' ? sp.projekt : null;
  const startupFilter = isMember ? user.linkedStartups[0] : typeof sp.bolag === 'string' ? sp.bolag : undefined;

  const [types, projects, rows] = await Promise.all([
    listCheckTypes(pb, user.tenant),
    isStaff ? listFundingProjects(pb, user.tenant) : Promise.resolve([]),
    listApplications(pb, user.tenant, {
      startupId: startupFilter,
      checkTypeId: typeFilter ?? undefined,
      projectId: projectFilter ?? undefined,
      statuses: statusFilter ? [statusFilter] : undefined
    })
  ]);
  const byType = typesById(types);
  const summary = summarizeSupportChecks(rows, byType, today);
  const projectName = new Map(projects.map((p) => [p.id, p.title]));
  const activeTypes = types.filter((t) => t.active !== false);

  return (
    <PageShell
      title="Stödcheckar"
      meta={<span className="text-sm text-foreground-subtle">{rows.length} ansökningar</span>}
      actions={
        <>
          {isStaff && (
            <Link href="/checkar/typer" className={btnGhost}>
              <Icon name="gear" size={13} /> Checktyper
            </Link>
          )}
          {isStaff && (
            <Link href="/checkar/regler" className={btnGhost}>
              <Icon name="zap" size={13} /> Uppföljningsregler
            </Link>
          )}
          {canManage && (
            <Link href="/projekt" className={btnGhost}>
              <Icon name="graph" size={13} /> Projekt
            </Link>
          )}
          {activeTypes.length > 0 && (
            <Link href="/checkar/ny" className={btnPrimary}>
              <Icon name="plus" size={13} /> Ny ansökan
            </Link>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {syncWarning && <Notice kind="warning">{syncWarning}</Notice>}
        <p className="text-sm text-foreground-muted">
          {isMember
            ? 'Här ser ni era ansökningar om stödcheckar, vad som väntas av er och beslut. Ansökan fylls i digitalt, signeras av firmatecknaren och bedöms av Movexum.'
            : 'Bolagens ansökningar om stödcheckar (excellens, resa, AI-verktyg …). Bedöm, begär komplettering, sätt finansiering per projekt/arbetspaket och besluta — de minimis-post och kapitalrad skapas automatiskt vid beviljande.'}
        </p>

        <KpiRow
          items={[
            { label: 'Öppna ärenden', value: summary.open, hint: `${summary.total} totalt` },
            { label: 'Väntar på Movexum', value: summary.awaitingMovexum, hint: summary.overdue > 0 ? `${summary.overdue} försenade` : undefined },
            { label: 'Väntar på bolaget', value: summary.awaitingCompany },
            { label: 'Beviljat', value: fmtSek(summary.grantedSek), hint: `${fmtSek(summary.paidSek)} utbetalt` }
          ]}
        />

        {isStaff && (
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <label className="flex flex-col gap-1 text-xs text-foreground-muted">
              Status
              <select name="status" defaultValue={statusFilter ?? ''} className="rounded-xl border border-default bg-surface px-2 py-1.5 text-sm text-foreground">
                <option value="">Alla</option>
                {SUPPORT_CHECK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_CHECK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-foreground-muted">
              Checktyp
              <select name="typ" defaultValue={typeFilter ?? ''} className="rounded-xl border border-default bg-surface px-2 py-1.5 text-sm text-foreground">
                <option value="">Alla</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-foreground-muted">
              Projekt
              <select name="projekt" defaultValue={projectFilter ?? ''} className="rounded-xl border border-default bg-surface px-2 py-1.5 text-sm text-foreground">
                <option value="">Alla</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={btnGhost}>
              Filtrera
            </button>
            {(statusFilter || typeFilter || projectFilter) && (
              <Link href="/checkar" className="text-xs text-link hover:underline">
                Rensa
              </Link>
            )}
          </form>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
            Inga ansökningar{statusFilter || typeFilter || projectFilter ? ' matchar filtret' : ' ännu'}.{' '}
            {activeTypes.length > 0 ? (
              <Link href="/checkar/ny" className="text-link hover:underline">
                Skapa den första
              </Link>
            ) : isStaff ? (
              <Link href="/checkar/typer" className="text-link hover:underline">
                Lägg upp en checktyp först
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-default bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="px-4 py-3">Ansökan</th>
                  {!isMember && <th className="px-4 py-3">Bolag</th>}
                  <th className="px-4 py-3">Fas</th>
                  <th className="px-4 py-3">Nästa steg</th>
                  <th className="px-4 py-3">Belopp</th>
                  {isStaff && <th className="px-4 py-3">Finansiering</th>}
                  <th className="px-4 py-3">Inskickad</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const type = byType.get(a.check_type);
                  const phase = supportCheckPhase(a, type, today);
                  const next = supportCheckNextStep(a, phase);
                  const granted = grantedAmount(a);
                  return (
                    <tr key={a.id} className="border-t border-default align-top">
                      <td className="px-4 py-3">
                        <Link href={`/checkar/${a.id}`} className="font-medium text-foreground hover:underline">
                          {a.title || type?.title || 'Ansökan'}
                        </Link>
                        <div className="text-xs text-foreground-subtle">{type?.title ?? 'Stödcheck'}</div>
                      </td>
                      {!isMember && (
                        <td className="px-4 py-3">
                          <Link href={`/startups/${a.startup}`} className="text-foreground-muted hover:underline">
                            {a.startup_name || 'Bolag'}
                          </Link>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <PhaseChip phase={phase} />
                      </td>
                      <td className="px-4 py-3 text-foreground-muted">
                        {next.label}
                        {next.who !== 'none' && <span className="text-foreground-subtle"> · {WHO_LABEL[next.who]}</span>}
                      </td>
                      <td className="px-4 py-3 text-foreground-muted mx-tnum">
                        {granted > 0 ? fmtSek(granted) : fmtSek(a.requested_amount_sek)}
                        {granted > 0 && <div className="text-xs text-foreground-subtle">beviljat</div>}
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {a.funding_project ? <span className="text-xs text-foreground-muted">{projectName.get(a.funding_project) ?? 'Projekt'}</span> : <span className="text-xs text-foreground-subtle">–</span>}
                            <BasisChip basis={a.state_aid_basis} />
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3 text-foreground-muted mx-tnum">{fmtDate(a.submitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
