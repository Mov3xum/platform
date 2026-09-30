import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { buildProjectOverview, listFundingLedger, listFundingProjects, listWorkPackages } from '@/lib/funding/data';
import { FUNDING_PROJECT_KIND_LABELS, FUNDING_PROJECT_STATUS_LABELS, FUNDING_BASIS_SHORT, type Role } from '@platform/shared';
import { KpiRow, btnPrimary, fmtDate, fmtSek } from '@/app/checkar/ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

const SIGNAL_TONE: Record<string, string> = {
  ok: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  behind: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  over: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  none: 'bg-canvas-muted text-foreground-muted'
};
const SIGNAL_LABEL: Record<string, string> = { ok: 'I fas', behind: 'Under plan', over: 'Över budget', none: 'Ingen budget' };

export default async function ProjektPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'projekt', user.enabledModules)) redirect('/hem');
  const canManage = hasRole(user.roles, LEAD_ROLES);
  const pb = await getServerPb();
  const [projects, wps, ledger] = await Promise.all([listFundingProjects(pb, user.tenant), listWorkPackages(pb, user.tenant), listFundingLedger(pb, user.tenant)]);
  const overviews = projects.map((p) => buildProjectOverview(p, wps, ledger));
  const totalBudget = overviews.reduce((a, o) => a + (o.burn.budgetSek ?? 0), 0);
  const totalGranted = overviews.reduce((a, o) => a + o.burn.grantedSek, 0);
  const totalPaid = overviews.reduce((a, o) => a + o.burn.paidSek, 0);

  return (
    <PageShell
      title="Projekt"
      meta={<span className="text-sm text-foreground-subtle">{projects.length} projekt</span>}
      actions={
        canManage ? (
          <Link href="/projekt/ny" className={btnPrimary}>
            <Icon name="plus" size={13} /> Nytt projekt
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-foreground-muted">
          Projekten är kassorna stöd tas ur (Vinnova Excellens, TVV, EoI, Bas …) och arbetspaketen deras redovisningsenheter. Beviljade stödcheckar belastar projekt och arbetspaket vid beslut — upparbetningen räknas live ur ansökningarna.
        </p>
        <KpiRow
          items={[
            { label: 'Budget', value: fmtSek(totalBudget) },
            { label: 'Beviljat', value: fmtSek(totalGranted), hint: totalBudget > 0 ? `${Math.round((totalGranted / totalBudget) * 100)} % av budget` : undefined },
            { label: 'Utbetalt', value: fmtSek(totalPaid) },
            { label: 'Kvar att bevilja', value: fmtSek(Math.max(0, totalBudget - totalGranted)) }
          ]}
        />
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
            Inga projekt än.{' '}
            {canManage && (
              <Link href="/projekt/ny" className="text-link hover:underline">
                Skapa det första
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-default bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="px-4 py-3">Projekt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Budget</th>
                  <th className="px-4 py-3">Beviljat</th>
                  <th className="px-4 py-3">Utbetalt</th>
                  <th className="px-4 py-3">Upparbetning</th>
                </tr>
              </thead>
              <tbody>
                {overviews.map(({ project: p, burn, applications }) => (
                  <tr key={p.id} className="border-t border-default align-top">
                    <td className="px-4 py-3">
                      <Link href={`/projekt/${p.id}`} className="font-medium text-foreground hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-foreground-subtle">
                        {FUNDING_PROJECT_KIND_LABELS[p.kind]}
                        {p.default_state_aid_basis ? ` · ${FUNDING_BASIS_SHORT[p.default_state_aid_basis]}` : ''} · {applications} checkar
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{FUNDING_PROJECT_STATUS_LABELS[p.status]}</td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">{fmtDate(p.starts_at)} – {fmtDate(p.ends_at)}</td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">{fmtSek(burn.budgetSek)}</td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">{fmtSek(burn.grantedSek)}{burn.pctGranted !== null && <span className="text-xs text-foreground-subtle"> ({burn.pctGranted} %)</span>}</td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">{fmtSek(burn.paidSek)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SIGNAL_TONE[burn.signal]}`}>{SIGNAL_LABEL[burn.signal]}</span>
                      {burn.pctElapsed !== null && <div className="mt-1 text-xs text-foreground-subtle mx-tnum">{burn.pctElapsed} % av perioden</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
