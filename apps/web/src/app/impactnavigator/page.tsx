import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import { listImpactCompanies } from '@/lib/impact/data';
import { ImpactStatusChip, ImpactLevelChip } from '@/components/impact/chips';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { canManageImpact, type StartupPhase } from '@platform/shared';

export const dynamic = 'force-dynamic';

/**
 * Impact Navigator (CLAUDE.md § 56) — bolagslistan. Läser med användarens
 * token (RLS § 21: sustainability_* är staff/observer-only). Knapparna är
 * UI-kurering; gränsen ligger i server-actionerna.
 */
export default async function ImpactNavigatorPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const { items, latest, error } = await listImpactCompanies(pb, user.tenant);
  const withAnalysis = items.filter((c) => c.status || latest.has(c.id));
  const without = items.filter((c) => !c.status && !latest.has(c.id) && c.startupStatus === 'active');
  const canManage = canManageImpact(user.roles);
  const btnPrimary =
    'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover';

  return (
    <PageShell
      title="Impact Navigator"
      meta={<span className="text-sm text-foreground-muted">{withAnalysis.length} bolag med hållbarhetsanalys</span>}
      actions={canManage ? <Link href="/impactnavigator/ny" className={btnPrimary}>Ny analys</Link> : null}
    >
      <div className="space-y-6">
        <AiNoticeBanner />
        {error ? <p className="rounded-2xl border border-movexum-gul/40 bg-movexum-pastell-gul p-3 text-sm text-movexum-morkgul">{error}</p> : null}

        <section className="rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
          <div className="border-b border-default px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">Bolag under analys</h2>
            <p className="text-xs text-foreground-muted">Väsentliga hållbarhetsaspekter, kompletteringar och slutanalys per bolag — beslutsstöd för coachen, inte ett omdöme om personer.</p>
          </div>
          {withAnalysis.length === 0 ? (
            <p className="px-5 py-8 text-sm text-foreground-muted">Ingen analys ännu. {canManage ? <Link href="/impactnavigator/ny" className="text-link underline">Starta den första.</Link> : null}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-foreground-subtle">
                  <tr>
                    <th className="px-5 py-3">Bolag</th>
                    <th className="px-3 py-3">Fas</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Impactnivå</th>
                    <th className="px-3 py-3 text-right">Version</th>
                    <th className="px-3 py-3 text-right mx-tnum">Underlag</th>
                    <th className="px-3 py-3">Ansvarig</th>
                  </tr>
                </thead>
                <tbody>
                  {withAnalysis.map((c) => {
                    const a = latest.get(c.id);
                    return (
                      <tr key={c.id} className="border-t border-default hover:bg-canvas-subtle">
                        <td className="px-5 py-3">
                          <Link href={`/impactnavigator/${c.id}`} className="font-semibold text-foreground hover:text-link">{c.name}</Link>
                          {c.industry ? <div className="text-xs text-foreground-subtle">{c.industry}</div> : null}
                        </td>
                        <td className="px-3 py-3 text-foreground-muted">{phaseLabels[c.phase as StartupPhase] ?? c.phase}</td>
                        <td className="px-3 py-3"><ImpactStatusChip status={c.status} /></td>
                        <td className="px-3 py-3">{a?.dashboard ? <ImpactLevelChip level={a.dashboard.impactLevel.level} /> : <span className="text-foreground-subtle">–</span>}</td>
                        <td className="px-3 py-3 text-right mx-tnum">{a ? `v${a.version}` : '–'}</td>
                        <td className="px-3 py-3 text-right mx-tnum">{a?.informationQualityScore != null ? `${a.informationQualityScore} %` : '–'}</td>
                        <td className="px-3 py-3 text-foreground-muted">{c.assignedToName ?? '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canManage && without.length > 0 ? (
          <section className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
            <h2 className="text-base font-semibold text-foreground">Aktiva bolag utan analys</h2>
            <p className="mb-3 text-xs text-foreground-muted">Starta en analys på ett befintligt bolagskort — bolagets namn, fas och bransch följer med.</p>
            <div className="flex flex-wrap gap-2">
              {without.map((c) => (
                <Link key={c.id} href={`/impactnavigator/ny?startup=${c.id}`} className="rounded-full border border-default bg-canvas px-3 py-1 text-sm text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground">
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
