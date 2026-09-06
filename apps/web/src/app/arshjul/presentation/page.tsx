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
export default async function ArshjulPresentationPage() {
  const user = await requireUser();
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

  return <AnnualWheelPresentation items={items} categories={categories} />;
}
