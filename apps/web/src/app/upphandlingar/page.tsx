import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { listCalloffs, listProcurements, todayKey } from '@/lib/procurements/data';
import { syncAllProcurementFollowups } from '@/lib/procurements/followups';
import { summarizeProcurement, type Role } from '@platform/shared';
import { AlertChip, ExcellenceChip, Notice, StatusChip, btnGhost, btnPrimary, fmtDate } from './ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export default async function UpphandlingarPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'upphandlingar', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const onlyExcellence = sp.excellens === '1';
  const canEdit = hasRole(user.roles, STAFF_ROLES);
  const pb = await getServerPb();

  // Lazy synk (§ 39.2): reglerna tickar mot klockan även om ingen rört
  // upphandlingen — sidladdningen håller uppgifterna i takt. Fail-soft.
  let syncWarning: string | null = null;
  if (canEdit) {
    const results = await syncAllProcurementFollowups(pb, {
      kind: 'user',
      id: user.id,
      tenant: user.tenant,
      roles: user.roles
    }).catch(() => []);
    syncWarning = results.find((r) => r.error)?.error ?? null;
  }

  const [procurements, calloffs] = await Promise.all([listProcurements(pb, user.tenant), listCalloffs(pb, user.tenant)]);
  const today = todayKey();
  const rows = procurements
    .filter((p) => !onlyExcellence || p.is_excellence_activity)
    .map((p) => ({
      p,
      summary: summarizeProcurement(
        calloffs.filter((c) => c.procurement === p.id),
        today
      )
    }));
  const totalAlerts = rows.reduce((a, r) => a + r.summary.alerts, 0);

  return (
    <PageShell
      title="Upphandlingar"
      meta={
        <span className="text-sm text-foreground-subtle">
          {rows.length} st{totalAlerts > 0 ? ` · ${totalAlerts} avvikelser` : ''}
        </span>
      }
      actions={
        <>
          <Link href={onlyExcellence ? '/upphandlingar' : '/upphandlingar?excellens=1'} className={btnGhost}>
            {onlyExcellence ? 'Visa alla' : 'Bara excellens'}
          </Link>
          <Link href="/upphandlingar/regler" className={btnGhost}>
            <Icon name="gear" size={13} /> Uppföljningsregler
          </Link>
          {canEdit && (
            <Link href="/upphandlingar/ny" className={btnPrimary}>
              <Icon name="plus" size={13} /> Ny upphandling
            </Link>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {syncWarning && <Notice kind="warning">{syncWarning}</Notice>}
        <p className="text-sm text-foreground-muted">
          Ladda upp underlaget för en upphandling så läses uppgifterna ut och uppföljningen sätts upp
          automatiskt enligt reglerna: avrop per bolag, milstolpar, slutrapporter, kvartalsavstämningar och
          utvärdering av leverantören. Uppföljningarna dyker upp som uppgifter på bolagens tavlor och i din
          översikt.
        </p>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
            Inga upphandlingar ännu.{' '}
            {canEdit && (
              <Link href="/upphandlingar/ny" className="text-link hover:underline">
                Ladda upp den första
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-default bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="px-4 py-3">Upphandling</th>
                  <th className="px-4 py-3">Leverantör</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Avtal</th>
                  <th className="px-4 py-3">Avrop</th>
                  <th className="px-4 py-3">Betyg</th>
                  <th className="px-4 py-3">Avvikelser</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, summary }) => (
                  <tr key={p.id} className="border-t border-default align-top">
                    <td className="px-4 py-3">
                      <Link href={`/upphandlingar/${p.id}`} className="font-medium text-foreground hover:underline">
                        {p.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">{p.is_excellence_activity && <ExcellenceChip />}</div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{p.supplier || '–'}</td>
                    <td className="px-4 py-3">
                      <StatusChip status={p.status as never} />
                    </td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">
                      {fmtDate(p.contract_start)} – {fmtDate(p.contract_end)}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">
                      {summary.calloffs}
                      {summary.activeCalloffs > 0 && <span className="text-foreground-subtle"> ({summary.activeCalloffs} pågår)</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted mx-tnum">
                      {summary.score === null ? '–' : `${summary.score.toFixed(1)} / 5`}
                      {summary.evaluated > 0 && <span className="text-foreground-subtle"> ({summary.evaluated})</span>}
                    </td>
                    <td className="px-4 py-3">{summary.alerts > 0 ? <AlertChip label={`${summary.alerts}`} /> : <span className="text-foreground-subtle">–</span>}</td>
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
