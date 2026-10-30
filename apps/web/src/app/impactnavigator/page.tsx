import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import { listImpactCompanies, type ImpactCompany } from '@/lib/impact/data';
import { IMPACT_COMPARE_HREF, IMPACT_NEW_HREF, impactHref } from '@/lib/impact/tabs';
import { Badge, ImpactLevelBadge, ImpactStatusChip } from '@/components/impact/chips';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { AutoSubmitSelect } from '@/components/impact/AutoSubmitSelect';
import { btnPrimary, btnSecondary, inputClass, labelClass, noticeWarn } from '@/components/impact/ui';
import { Icon } from '@/components/proto/Icon';
import { ALL_PHASES, IMPACT_LEVELS, IMPACT_LEVEL_LABELS, canDeleteImpact, canManageImpact, isImpactLevel, type StartupPhase } from '@platform/shared';
import { DeleteCompanyButton } from './DeleteCompanyButton';

export const dynamic = 'force-dynamic';

const NOT_ASSESSED = 'NOT_ASSESSED';

/**
 * Impact Navigator (CLAUDE.md § 56) — bolagsöversikten (originalets
 * /companies): sök på namn/bransch/beskrivning, filter på fas och övergripande
 * bedömning (impactnivå), kortrutnät med status/fas/nivå, "Öppna" (dashboard
 * om det finns en, annars väsentligheten) och Radera (ledning). Läser med
 * användarens token (RLS § 21: sustainability_* är staff/observer-only).
 */
export default async function ImpactNavigatorPage({ searchParams }: { searchParams: Promise<{ q?: string; phase?: string; analysis?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const query = await searchParams;
  const q = (query.q ?? '').trim().slice(0, 120);
  const phase = (ALL_PHASES as readonly string[]).includes(query.phase ?? '') ? (query.phase as StartupPhase) : undefined;
  const analysis = query.analysis === NOT_ASSESSED || isImpactLevel(query.analysis) ? query.analysis : undefined;

  const pb = await getServerPb();
  const { items, latest, latestComplete, error } = await listImpactCompanies(pb, user.tenant);
  const canManage = canManageImpact(user.roles);
  const canDelete = canDeleteImpact(user.roles);

  // Bolag i Impact Navigator = de som har en hållbarhetsstatus eller någon analysversion.
  const inNavigator = items.filter((c) => c.status || latest.has(c.id));
  const needle = q.toLocaleLowerCase('sv');
  const companies = inNavigator
    .filter((c) => !phase || c.phase === phase)
    .filter((c) => !needle || [c.name, c.industry, c.journeyText].some((v) => v.toLocaleLowerCase('sv').includes(needle)))
    .filter((c) => {
      if (!analysis) return true;
      const level = latestComplete.get(c.id)?.dashboard?.impactLevel.level;
      return analysis === NOT_ASSESSED ? !level : level === analysis;
    });
  const withoutAnalysis = items.filter((c) => !c.status && !latest.has(c.id) && c.startupStatus === 'active');

  return (
    <PageShell
      title="Alla bolag"
      meta={<span className="text-sm text-foreground-muted">Impact Navigator · {inNavigator.length} bolag</span>}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href={IMPACT_COMPARE_HREF} className={btnSecondary}>
            Jämförelser
          </Link>
          {canManage ? (
            <Link href={IMPACT_NEW_HREF} className={btnPrimary}>
              <Icon name="plus" size={15} />
              Skapa nytt bolag
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        <AiNoticeBanner generated={latestComplete.size > 0} />
        {error ? <p className={noticeWarn}>{error}</p> : null}

        <section aria-labelledby="companies-title">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
            Bolagsöversikt
          </p>
          <h2 id="companies-title" className="mt-2 font-heading text-2xl font-semibold text-foreground">
            Hållbarhetsanalyser per bolag
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            Hantera screening, risker, möjligheter och väsentlighetsbedömningar för portföljbolag och inkommande bolag.
          </p>
        </section>

        <form method="get" className="grid gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 md:grid-cols-[minmax(0,1.3fr)_minmax(210px,0.8fr)_minmax(230px,0.9fr)] md:items-end">
          <label className="block">
            <span className={labelClass}>Sök bolag</span>
            <input name="q" defaultValue={q} placeholder="Namn, bransch eller beskrivning" className={`${inputClass} mt-1.5`} />
          </label>
          <label className="block">
            <span className={labelClass}>Movexumfas</span>
            <AutoSubmitSelect name="phase" defaultValue={phase ?? ''} className={`${inputClass} mt-1.5`}>
              <option value="">Alla faser</option>
              {ALL_PHASES.map((p) => (
                <option key={p} value={p}>
                  {phaseLabels[p]}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
          <label className="block">
            <span className={labelClass}>Övergripande bedömning</span>
            <AutoSubmitSelect name="analysis" defaultValue={analysis ?? ''} className={`${inputClass} mt-1.5`}>
              <option value="">Alla övergripande bedömningar</option>
              {IMPACT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {IMPACT_LEVEL_LABELS[level]}
                </option>
              ))}
              <option value={NOT_ASSESSED}>Ej bedömt</option>
            </AutoSubmitSelect>
          </label>
          <input type="submit" hidden />
        </form>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} level={latestComplete.get(company.id)?.dashboard?.impactLevel.level ?? null} hasDashboard={latestComplete.has(company.id)} canDelete={canDelete} />
          ))}
        </div>

        {companies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-strong bg-canvas-subtle px-6 py-12 text-center">
            <p className="font-medium text-foreground">{inNavigator.length === 0 ? 'Inga bolag i Impact Navigator ännu' : 'Inga bolag matchar filtret'}</p>
            <p className="mt-1 text-sm text-foreground-muted">
              {inNavigator.length === 0 ? (
                canManage ? (
                  <>
                    <Link href={IMPACT_NEW_HREF} className="text-link underline">
                      Skapa det första bolaget
                    </Link>{' '}
                    eller starta en analys på ett befintligt bolagskort nedan.
                  </>
                ) : (
                  'Movexum-personal startar den första analysen.'
                )
              ) : (
                'Justera sökningen, fasen eller den övergripande bedömningen.'
              )}
            </p>
          </div>
        ) : null}

        {canManage && withoutAnalysis.length > 0 ? (
          <section className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
            <h3 className="font-heading text-base font-semibold text-foreground">Aktiva bolag utan analys</h3>
            <p className="mb-3 text-xs text-foreground-muted">Starta en analys på ett befintligt bolagskort — namn, fas och bransch följer med.</p>
            <div className="flex flex-wrap gap-2">
              {withoutAnalysis.map((c) => (
                <Link key={c.id} href={`${IMPACT_NEW_HREF}?startup=${c.id}`} className="rounded-full border border-default bg-canvas px-3 py-1 text-sm text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground">
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

function CompanyCard({ company, level, hasDashboard, canDelete }: { company: ImpactCompany; level: string | null; hasDashboard: boolean; canDelete: boolean }) {
  return (
    <article className="group relative flex min-h-[270px] flex-col overflow-hidden rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md hover:shadow-movexum-svart/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-lg font-semibold text-foreground">{company.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-foreground-muted">{company.industry || 'Bransch ej angiven'}</p>
        </div>
        <ImpactStatusChip status={company.status} />
      </div>

      <div className="mt-6 border-t border-default pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Movexumfas</p>
        <div className="mt-2">
          <Badge tone="info">{phaseLabels[company.phase as StartupPhase] ?? company.phase}</Badge>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Övergripande bedömning</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ImpactLevelBadge level={level} />
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-default pt-4">
        <Link href={impactHref(company.id, hasDashboard ? 'dashboard' : 'vasentlighet')} className={btnSecondary}>
          Öppna
          <Icon name="arrow-up-right" size={14} />
        </Link>
        {canDelete ? <DeleteCompanyButton startupId={company.id} companyName={company.name} /> : null}
      </div>
    </article>
  );
}
