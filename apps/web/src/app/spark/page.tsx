import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import {
  SPARK_ENERGY_AREAS,
  SPARK_PROJECT_TARGETS,
  computeSparkIndicators,
  effectiveSparkTrl,
  sparkAcceleratorEligible,
  sparkAreaBalance
} from '@platform/shared';
import { SPARK_MIGRATION_HINT, listSparkInterviews, loadSparkRegistry } from '@/lib/spark/data';
import { Chip, Notice, Panel, btnPrimary } from '@/components/talent/ui';
import { SPARK_TITLE, requireSparkStaff, sparkTabs } from './_shared';

export const dynamic = 'force-dynamic';

function Figure({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="block font-heading text-3xl font-semibold text-foreground mx-tnum">{value}</span>
      <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-foreground-muted">{hint}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl border border-default bg-surface p-4 transition hover:border-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border border-default bg-surface p-4">{body}</div>
  );
}

function Target({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground-muted">{label}</span>
        <span className="font-semibold text-foreground mx-tnum">
          {value} av {target}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Översikten (§ 61): läget i registret, projektets indikatorer och var luckorna finns. */
export default async function SparkOverviewPage() {
  const { user, pb, canManage } = await requireSparkStaff();
  const [reg, interviews] = await Promise.all([loadSparkRegistry(pb, user.tenant), listSparkInterviews(pb, user.tenant)]);
  const submitted = interviews.items.filter((i) => i.status === 'submitted').length;
  const openNeeds = reg.needs.filter((n) => n.status === 'open' || n.status === 'matched');
  const activeSolutions = reg.solutions.filter((s) => s.status === 'active');
  const indicators = computeSparkIndicators(reg);
  const balance = sparkAreaBalance(
    SPARK_ENERGY_AREAS.map((a) => a.id),
    reg.needs,
    reg.solutions,
    reg.testbeds
  ).filter((b) => b.verdict !== 'empty');
  const candidates = reg.solutions.filter((s) => {
    const a = reg.actorById.get(s.actor);
    return a && sparkAcceleratorEligible(a) && s.status === 'active';
  });
  const unassessed = candidates.filter((s) => !s.accelerator_category).length;
  const withTrl = candidates.filter((s) => effectiveSparkTrl(s) !== null).length;

  return (
    <PageShell
      title={SPARK_TITLE}
      tabs={sparkTabs(true, { submitted: submitted || undefined })}
      actions={
        canManage ? (
          <Link href="/spark/intervjuer/ny" className={btnPrimary}>
            <Icon name="plus" size={14} /> Ny intervju
          </Link>
        ) : null
      }
    >
      <div className="space-y-5">
        {reg.missing ? <Notice kind="warning">{SPARK_MIGRATION_HINT}</Notice> : null}
        {reg.error ? <Notice kind="error">{reg.error}</Notice> : null}
        {reg.truncated ? <Notice kind="warning">Registret är större än vad som lästes — siffrorna nedan är en nedre gräns.</Notice> : null}
        {submitted > 0 ? (
          <Notice kind="warning">
            {submitted} {submitted === 1 ? 'intervju väntar' : 'intervjuer väntar'} på att föras in i registret.{' '}
            <Link href="/spark/intervjuer?status=submitted" className="font-semibold underline">
              Gå igenom dem
            </Link>
          </Notice>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Figure label="Aktörer" value={String(reg.actors.filter((a) => a.status === 'active').length)} href="/spark/aktorer" />
          <Figure label="Öppna behov" value={String(openNeeds.length)} href="/spark/matchning" />
          <Figure label="Lösningar" value={String(activeSolutions.length)} href="/spark/matchning?vy=losningar" />
          <Figure label="Testmiljöer och pilotkunder" value={String(reg.testbeds.filter((t) => t.status === 'available').length)} href="/spark/aktorer?roll=testbed" />
          <Figure label="Aktiva matchningar" value={String(reg.matches.filter((m) => m.status !== 'suggested' && m.status !== 'declined').length)} hint={`${indicators.pilots} i pilot eller genomförda`} href="/spark/matchning?vy=tavla" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Projektets mål" meta={<span className="text-xs text-foreground-subtle">ur ansökan, räknat ur registret</span>}>
            <div className="space-y-4">
              <Target label="Behovsägare som deltar i en matchning eller pilot" value={indicators.needOwnersInvolved} target={SPARK_PROJECT_TARGETS.need_owners} />
              <Target label="Företag som fått en bekräftad stödinsats" value={indicators.supportedCompanies} target={SPARK_PROJECT_TARGETS.supported_companies} />
              <Target label="Aktörer som använder matchningen" value={indicators.structureUsers} target={SPARK_PROJECT_TARGETS.structure_users} />
              <Target label="Matchningar med forskningsaktör" value={indicators.researchCollaborations} target={SPARK_PROJECT_TARGETS.research_collaborations} />
            </div>
          </Panel>

          <Panel
            title="Acceleratorprogrammet"
            actions={
              <Link href="/spark/accelerator" className="text-sm font-medium text-link hover:underline">
                Öppna
              </Link>
            }
          >
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <span className="block font-heading text-2xl font-semibold text-foreground mx-tnum">{candidates.length}</span>
                <span className="text-xs text-foreground-muted">lösningar att bedöma</span>
              </div>
              <div>
                <span className="block font-heading text-2xl font-semibold text-foreground mx-tnum">{withTrl}</span>
                <span className="text-xs text-foreground-muted">har TRL</span>
              </div>
              <div>
                <span className="block font-heading text-2xl font-semibold text-foreground mx-tnum">{unassessed}</span>
                <span className="text-xs text-foreground-muted">utan kategori</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-foreground-subtle">Bara lösningar från innovationsaktörer utanför portföljen. Behovsägare bedöms inte, och portföljbolag bedöms med IRL på bolagskortet.</p>
          </Panel>
        </div>

        <Panel title="Behov och lösningar per energiområde" meta={<span className="text-xs text-foreground-subtle">visar var luckorna finns</span>}>
          {balance.length === 0 ? (
            <p className="text-sm text-foreground-muted">Inga behov eller lösningar är registrerade än.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs text-foreground-subtle">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Energiområde</th>
                    <th className="px-3 py-2 text-right font-semibold">Behov</th>
                    <th className="px-3 py-2 text-right font-semibold">Lösningar</th>
                    <th className="px-3 py-2 text-right font-semibold">Testmiljöer</th>
                    <th className="py-2 pl-3 font-semibold">Läge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {balance.map((b) => (
                    <tr key={b.area}>
                      <td className="py-2 pr-3 text-foreground">{SPARK_ENERGY_AREAS.find((a) => a.id === b.area)?.label}</td>
                      <td className="px-3 py-2 text-right mx-tnum">{b.needs}</td>
                      <td className="px-3 py-2 text-right mx-tnum">{b.solutions}</td>
                      <td className="px-3 py-2 text-right mx-tnum">{b.testbeds}</td>
                      <td className="py-2 pl-3">
                        {b.verdict === 'gap' ? <Chip tone="danger">Behov utan lösning</Chip> : b.verdict === 'surplus' ? <Chip tone="warning">Lösning utan behov</Chip> : <Chip tone="success">Går att matcha</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
