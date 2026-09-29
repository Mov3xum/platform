import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { loadGoalWorkspace } from '@/lib/goals/data';
import { currentQuarter } from '@/lib/core/write';
import { GoalsPresentation } from './GoalsPresentation';

export const dynamic = 'force-dynamic';

/**
 * Målstyrningens PRESENTATIONSLÄGE (CLAUDE.md § 42) — helskärmsyta för
 * kvartalsgenomgången på projektorn. Samma RBAC och samma läsväg som /mal
 * (användarens token → RLS § 21); root-layouten tar bort railen för exakt
 * den här sökvägen (`PRESENTATION_PATHS`). Ren läsvy: inga skrivningar.
 */
export default async function MalPresentationPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'mal', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const yearRaw = typeof sp.ar === 'string' ? Number(sp.ar) : NaN;
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : null;
  const quarterRaw = typeof sp.q === 'string' ? Number(sp.q) : NaN;
  const quarter = quarterRaw >= 1 && quarterRaw <= 4 ? (quarterRaw as 1 | 2 | 3 | 4) : currentQuarter();

  const pb = await getServerPb();
  const ws = await loadGoalWorkspace(pb, user.tenant, user.id, year);
  return <GoalsPresentation workspace={ws} initialQuarter={quarter} />;
}
