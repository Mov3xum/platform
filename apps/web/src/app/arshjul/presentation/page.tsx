import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { listForTenant } from '@/lib/pb.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import { listAnnualWheelCategories } from '@/lib/annual-wheel/categories';
import { sanitizeAnnualWheelTags, sanitizeDay, sanitizeMonth } from '@platform/shared';
import type { AnnualWheelItem } from '@platform/shared';
import { AnnualWheelPresentation } from './AnnualWheelPresentation';

export const dynamic = 'force-dynamic';

interface WheelRow {
  id: string;
  tenant: string;
  year?: number;
  title?: string;
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  tags?: string[] | string | null;
  track?: string;
  category?: string;
  responsible?: string;
  notes?: string;
}

/**
 * Årshjulets PRESENTATIONSLÄGE (CLAUDE.md § 30) — helskärmsyta för
 * måndagsgenomgången på projektorn. Samma RBAC och samma läsväg som /arshjul
 * (användarens auth-token → PB-RLS, § 21); root-layouten tar bort railen för
 * exakt den här sökvägen. Ren läsvy: inga skrivningar, ingen ny dataväg.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

export default async function ArshjulPresentationPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireUser();
  // Startfilter från /arshjul ("Presentera" tar med aktuellt urval). Allt
  // valideras i klienten mot de faktiska kategorierna/personerna — ett okänt
  // värde faller tyst tillbaka på "alla".
  const params = (await searchParams) ?? {};
  const yearParam = Number(first(params.year));
  const initialYear = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : null;
  const initialCategories = (first(params.cat) ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 50);
  const initialTag = first(params.tag);
  const initialResponsible = first(params.resp);
  const monthParam = Number(first(params.month));
  const initialMonth = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : null;
  if (!canAccessModuleForUser(user.roles, 'arshjul', user.disabledModules)) redirect('/chatt');

  const pb = await getServerPb();
  const [res, categories, people] = await Promise.all([
    listForTenant<WheelRow>('annual_wheel_items', { sort: 'year,month', perPage: 500 }).catch(
      () => ({ items: [] as WheelRow[] })
    ),
    listAnnualWheelCategories(pb, user.tenant),
    listAssignableResourcesForTenant(pb, user.tenant)
  ]);

  const fallbackCategory = categories[0]?.id ?? 'gemensamt';
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  const items: AnnualWheelItem[] = res.items.map((r) => ({
    id: r.id,
    tenant: r.tenant,
    year: typeof r.year === 'number' ? r.year : Number(r.year) || new Date().getFullYear(),
    title: r.title || '(namnlös)',
    month: sanitizeMonth(r.month),
    day: sanitizeDay(r.day),
    end_month: sanitizeMonth(r.end_month),
    end_day: sanitizeDay(r.end_day),
    tags: sanitizeAnnualWheelTags(r.tags === undefined || r.tags === null ? r.track : r.tags),
    responsible: r.responsible || null,
    responsible_name: r.responsible ? (nameById.get(r.responsible) ?? null) : null,
    category: typeof r.category === 'string' && r.category ? r.category : fallbackCategory,
    notes: r.notes || undefined
  }));

  return (
    <AnnualWheelPresentation
      items={items}
      categories={categories}
      people={people}
      initialMonth={initialMonth}
      initialYear={initialYear}
      initialCategories={initialCategories}
      initialTag={initialTag}
      initialResponsible={initialResponsible}
    />
  );
}
