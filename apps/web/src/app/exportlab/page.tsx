import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import { listExportCompanies, type ExportCompany } from '@/lib/export-lab/data';
import { EXPORT_NEW_HREF, exportHref } from '@/lib/export-lab/tabs';
import { Badge, ExportStatusChip, PathwayChip, ReadinessLevelBadge } from '@/components/exportlab/chips';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { AutoSubmitSelect } from '@/components/impact/AutoSubmitSelect';
import { btnPrimary, btnSecondary, eyebrowAccent, inputClass, labelClass, noticeWarn } from '@/components/exportlab/ui';
import { Icon } from '@/components/proto/Icon';
import { ALL_PHASES, EXPORT_FRAMEWORKS, EXPORT_READINESS_LEVELS, EXPORT_READINESS_LEVEL_LABELS, canDeleteExportLab, canManageExportLab, isExportReadinessLevel, type ExportPathway, type StartupPhase } from '@platform/shared';
import { DeleteCompanyButton } from './DeleteCompanyButton';

export const dynamic = 'force-dynamic';

const NOT_ASSESSED = 'NOT_ASSESSED';

/**
 * Export Lab (CLAUDE.md § 58) — bolagsöversikten: sök på namn/bransch/
 * ambition, filter på fas och exportmognad, kortrutnät med status/väg/nivå.
 * Bara bolag som finns i Export Lab listas — övriga bolagskort väljs under
 * "Starta exportanalys". Läser med användarens token (RLS § 21).
 */
export default async function ExportLabPage({ searchParams }: { searchParams: Promise<{ q?: string; phase?: string; level?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'exportlab', user.enabledModules)) redirect('/hem');
  const query = await searchParams;
  const q = (query.q ?? '').trim().slice(0, 120);
  const phase = (ALL_PHASES as readonly string[]).includes(query.phase ?? '') ? (query.phase as StartupPhase) : undefined;
  const level = query.level === NOT_ASSESSED || isExportReadinessLevel(query.level) ? query.level : undefined;

  const pb = await getServerPb();
  const { items, latest, latestComplete, error } = await listExportCompanies(pb, user.tenant);
  const canManage = canManageExportLab(user.roles);
  const canDelete = canDeleteExportLab(user.roles);

  const inLab = items.filter((c) => c.status || latest.has(c.id));
  const needle = q.toLocaleLowerCase('sv');
  const companies = inLab
    .filter((c) => !phase || c.phase === phase)
    .filter((c) => !needle || [c.name, c.industry, c.ambitionText, c.desiredMarkets].some((v) => v.toLocaleLowerCase('sv').includes(needle)))
    .filter((c) => {
      if (!level) return true;
      const l = latestComplete.get(c.id)?.plan?.internationalStrategy.readinessLevel.level;
      return level === NOT_ASSESSED ? !l : l === level;
    });

  return (
    <PageShell
      title="Export Lab"
      meta={<span className="text-sm text-foreground-muted">Internationalisering per bolag · {inLab.length} bolag</span>}
      actions={
        canManage ? (
          <Link href={EXPORT_NEW_HREF} className={btnPrimary}>
            <Icon name="plus" size={15} />
            Starta exportanalys
          </Link>
        ) : null
      }
    >
      <div className="space-y-6">
        <AiNoticeBanner generated={latestComplete.size > 0} />
        {error ? <p className={noticeWarn}>{error}</p> : null}

        <section aria-labelledby="companies-title">
          <p className={eyebrowAccent}>
            <span className="h-1.5 w-1.5 rounded-full bg-movexum-bla" aria-hidden="true" />
            Bolagsöversikt
          </p>
          <h2 id="companies-title" className="mt-2 font-heading text-2xl font-semibold text-foreground">
            Exportplaner per bolag
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            Från innovation och IRL till marknadsval, inträdesform, regelverk, kulturell spelbok och en första exportplan — byggt på beprövade modeller för internationalisering.
          </p>
        </section>

        <form method="get" className="grid gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 md:grid-cols-[minmax(0,1.3fr)_minmax(210px,0.8fr)_minmax(230px,0.9fr)] md:items-end">
          <label className="block">
            <span className={labelClass}>Sök bolag</span>
            <input name="q" defaultValue={q} placeholder="Namn, bransch, ambition eller marknad" className={`${inputClass} mt-1.5`} />
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
            <span className={labelClass}>Exportmognad</span>
            <AutoSubmitSelect name="level" defaultValue={level ?? ''} className={`${inputClass} mt-1.5`}>
              <option value="">Alla nivåer</option>
              {EXPORT_READINESS_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {EXPORT_READINESS_LEVEL_LABELS[l]}
                </option>
              ))}
              <option value={NOT_ASSESSED}>Ej bedömt</option>
            </AutoSubmitSelect>
          </label>
          <input type="submit" hidden />
        </form>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => {
            const plan = latestComplete.get(company.id)?.plan ?? null;
            return <CompanyCard key={company.id} company={company} level={plan?.internationalStrategy.readinessLevel.level ?? null} pathway={plan?.internationalStrategy.pathway.code ?? null} hasPlan={Boolean(plan)} canDelete={canDelete} />;
          })}
        </div>

        {companies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-strong bg-canvas-subtle px-6 py-12 text-center">
            <p className="font-medium text-foreground">{inLab.length === 0 ? 'Inga bolag i Export Lab ännu' : 'Inga bolag matchar filtret'}</p>
            <p className="mt-1 text-sm text-foreground-muted">
              {inLab.length === 0 ? (
                canManage ? (
                  <>
                    <Link href={EXPORT_NEW_HREF} className="text-link underline">
                      Starta den första exportanalysen
                    </Link>{' '}
                    — ett nytt bolag eller ett befintligt bolagskort.
                  </>
                ) : (
                  'Movexum-personal startar den första analysen.'
                )
              ) : (
                'Justera sökningen, fasen eller nivån.'
              )}
            </p>
          </div>
        ) : null}

        <details className="rounded-2xl border border-default bg-surface p-5 text-sm shadow-sm shadow-movexum-svart/5">
          <summary className="cursor-pointer font-heading font-semibold text-foreground">Så funkar det — forskningen bakom Export Lab</summary>
          <p className="mt-3 text-foreground-muted">
            Analysen resonerar med namngivna, beprövade modeller — aldrig egna påhittade ramverk. Varje steg granskas av en människa, och regelverk, tull och kulturella generaliseringar ska verifieras innan beslut.
          </p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {EXPORT_FRAMEWORKS.map((f) => (
              <li key={f.key} className="rounded-xl bg-canvas-subtle p-3">
                <p className="font-medium text-foreground">{f.name}</p>
                <p className="text-xs text-foreground-subtle">{f.source}</p>
                <p className="mt-1 text-foreground-muted">{f.usedFor}</p>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </PageShell>
  );
}

function CompanyCard({ company, level, pathway, hasPlan, canDelete }: { company: ExportCompany; level: string | null; pathway: ExportPathway | null; hasPlan: boolean; canDelete: boolean }) {
  return (
    <article className="group relative flex min-h-[270px] flex-col overflow-hidden rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition duration-300 hover:-translate-y-1 hover:border-movexum-djupbla/40 hover:shadow-lg hover:shadow-movexum-svart/10">
      <span aria-hidden="true" className="absolute inset-x-8 top-0 h-px origin-center scale-x-0 bg-gradient-to-r from-transparent via-movexum-bla to-transparent transition-transform duration-300 group-hover:scale-x-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-lg font-semibold text-foreground">{company.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-foreground-muted">{company.industry || 'Bransch ej angiven'}</p>
        </div>
        <ExportStatusChip status={company.status} />
      </div>
      <div className="mt-6 border-t border-default pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Movexumfas</p>
        <div className="mt-2">
          <Badge tone="info">{phaseLabels[company.phase as StartupPhase] ?? company.phase}</Badge>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Exportmognad & väg</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ReadinessLevelBadge level={level} />
          {pathway ? <PathwayChip pathway={pathway} /> : null}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-default pt-4">
        <Link href={exportHref(company.id, hasPlan ? 'plan' : 'marknader')} className={btnSecondary}>
          Öppna
          <Icon name="arrow-up-right" size={14} />
        </Link>
        {canDelete ? <DeleteCompanyButton startupId={company.id} companyName={company.name} /> : null}
      </div>
    </article>
  );
}
