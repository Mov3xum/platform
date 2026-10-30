import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import { listImpactCompanies } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { btnSecondary, eyebrow, noticeWarn } from '@/components/impact/ui';
import {
  ALL_PHASES,
  IMPACT_LEVEL_RANK,
  getImpactAreaAssessmentItems,
  getImpactDashboardInformationComment,
  getImpactLevelLabel,
  impactInformationRank,
  impactPotentialRank,
  type ImpactDashboard,
  type StartupPhase
} from '@platform/shared';

export const dynamic = 'force-dynamic';

type SortKey = 'company' | 'phase' | 'industry' | 'impact' | 'overall' | 'environment' | 'social' | 'governance' | 'information';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortKey, string> = {
  company: 'Bolag',
  phase: 'Fas',
  industry: 'Bransch',
  impact: 'Impactnivå',
  overall: 'Övergripande potential',
  environment: 'Miljö',
  social: 'Socialt',
  governance: 'Styrning',
  information: 'Informationsläge'
};

interface CompareRow {
  id: string;
  name: string;
  phase: string;
  industry: string;
  dashboard: ImpactDashboard | null;
  impactLabel: string;
  overall: string;
  environment: string;
  social: string;
  governance: string;
  information: string;
}

/**
 * Jämförelser (originalets /compare): alla bolag med senaste färdiga
 * slutanalys i en sorterbar tabell — impactnivå, områdespotential och
 * informationsläge. Ren läsvy med användarens token (RLS § 21).
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const query = await searchParams;
  const sort = parseSortKey(query.sort);
  const dir = parseSortDir(query.dir);
  const pb = await getServerPb();
  const { items, latest, latestComplete, error } = await listImpactCompanies(pb, user.tenant);

  const rows: CompareRow[] = items
    .filter((c) => c.status || latest.has(c.id))
    .map((company) => {
      const dashboard = latestComplete.get(company.id)?.dashboard ?? null;
      const areas = getImpactAreaAssessmentItems(dashboard);
      return {
        id: company.id,
        name: company.name,
        phase: company.phase,
        industry: company.industry,
        dashboard,
        impactLabel: getImpactLevelLabel(dashboard?.impactLevel.level) ?? '-',
        overall: dashboard ? areas[0]?.potentialLabel ?? '-' : '-',
        environment: dashboard ? areas[1]?.potentialLabel ?? '-' : '-',
        social: dashboard ? areas[2]?.potentialLabel ?? '-' : '-',
        governance: dashboard ? areas[3]?.potentialLabel ?? '-' : '-',
        information: dashboard ? getImpactDashboardInformationComment(dashboard) : '-'
      };
    })
    .sort((a, b) => compareRows(a, b, sort, dir));

  return (
    <PageShell
      title="Övergripande jämförelse"
      meta={
        <span className="text-sm text-foreground-muted">
          Sorterat på {SORT_LABELS[sort].toLowerCase()} {dir === 'desc' ? 'fallande' : 'stigande'}
        </span>
      }
      actions={
        <Link href="/impactnavigator" className={btnSecondary}>
          Alla bolag
        </Link>
      }
    >
      <div className="space-y-5">
        <div>
          <p className={eyebrow}>Jämförelser</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            Senaste färdiga slutanalys per bolag. Nivåer och potentialer är coachande bedömningar av bolag — inte ett omdöme om personer, och inte en hållbarhetsredovisning.
          </p>
        </div>
        {error ? <p className={noticeWarn}>{error}</p> : null}
        <div className="overflow-x-auto rounded-2xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas-subtle text-xs uppercase tracking-wide text-foreground-subtle">
              <tr>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <SortHeader key={key} sortKey={key} activeSort={sort} dir={dir}>
                    {SORT_LABELS[key]}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-default hover:bg-canvas-subtle">
                  <td className="px-4 py-3 font-medium">
                    <Link href={impactHref(row.id, row.dashboard ? 'dashboard' : 'vasentlighet')} className="text-foreground hover:text-link">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{phaseLabels[row.phase as StartupPhase] ?? row.phase}</td>
                  <td className="px-4 py-3 text-foreground-muted">{row.industry || '-'}</td>
                  <td className="px-4 py-3">{row.impactLabel}</td>
                  <td className="px-4 py-3">{row.overall}</td>
                  <td className="px-4 py-3">{row.environment}</td>
                  <td className="px-4 py-3">{row.social}</td>
                  <td className="px-4 py-3">{row.governance}</td>
                  <td className="px-4 py-3 text-foreground-muted">{row.information}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-foreground-muted">
                    Inga bolag att jämföra ännu.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}

function SortHeader({ sortKey, activeSort, dir, children }: { sortKey: SortKey; activeSort: SortKey; dir: SortDir; children: ReactNode }) {
  const isActive = sortKey === activeSort;
  const nextDir: SortDir = isActive && dir === 'asc' ? 'desc' : 'asc';
  return (
    <th className="px-4 py-3 font-medium">
      <Link href={`?sort=${sortKey}&dir=${nextDir}`} className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-canvas-muted hover:text-foreground">
        {children}
        <span className="text-foreground-subtle" aria-hidden="true">
          {isActive ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </Link>
    </th>
  );
}

function parseSortKey(value?: string): SortKey {
  return value && Object.prototype.hasOwnProperty.call(SORT_LABELS, value) ? (value as SortKey) : 'impact';
}

function parseSortDir(value?: string): SortDir {
  return value === 'asc' || value === 'desc' ? value : 'desc';
}

function compareRows(a: CompareRow, b: CompareRow, sort: SortKey, dir: SortDir): number {
  const direction = dir === 'asc' ? 1 : -1;
  const result = compareSortValues(getSortValue(a, sort), getSortValue(b, sort));
  if (result !== 0) return result * direction;
  return a.name.localeCompare(b.name, 'sv');
}

function getSortValue(row: CompareRow, sort: SortKey): string | number {
  switch (sort) {
    case 'company':
      return row.name;
    case 'phase':
      return (ALL_PHASES as readonly string[]).indexOf(row.phase);
    case 'industry':
      return row.industry;
    case 'impact':
      return row.dashboard ? IMPACT_LEVEL_RANK[row.dashboard.impactLevel.level] : -1;
    case 'overall':
      return impactPotentialRank(row.overall);
    case 'environment':
      return impactPotentialRank(row.environment);
    case 'social':
      return impactPotentialRank(row.social);
    case 'governance':
      return impactPotentialRank(row.governance);
    case 'information':
      return impactInformationRank(row.information);
  }
}

function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'sv', { sensitivity: 'base' });
}
