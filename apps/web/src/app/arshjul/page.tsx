import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { listForTenant } from '@/lib/pb.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { loadAnnualWheelCategories } from '@/lib/annual-wheel/categories';
import { PageShell } from '@/components/PageShell';
import { AnnualWheelView } from './AnnualWheelView';
import type { AnnualWheelItem, Role } from '@platform/shared';
import { isAnnualWheelTrack, sanitizeDay, sanitizeMonth } from '@platform/shared';

export const dynamic = 'force-dynamic';

const EDIT_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
/** Kategori-CRUD är superadmin-only (`admin` = högsta app-rollen, § 6). */
const CATEGORY_MANAGE_ROLES: Role[] = ['admin'];

interface WheelRow {
  id: string;
  tenant: string;
  year?: number;
  title?: string;
  month?: number | null;
  day?: number | null;
  track?: string;
  category?: string;
  notes?: string;
  created_by?: string;
  created?: string;
  updated?: string;
}

/**
 * Årshjulet (CLAUDE.md § 30) — Movexums verksamhetskalender. Staff/observer-vy
 * (en ren bolagsmedlem ser inte Movexums interna styrelse-/ledningsplanering,
 * § 21). Läser via användarens auth-token → PB-RLS gäller. Redigering kräver
 * staff-roll och går via det delade skrivlagret (samma kärna som chatt-agenten).
 */
export default async function ArshjulPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'arshjul', user.disabledModules)) redirect('/chatt');

  const pb = await getServerPb();
  const [res, loadedCategories] = await Promise.all([
    listForTenant<WheelRow>('annual_wheel_items', {
      sort: 'year,month',
      perPage: 500
    }).catch(() => ({ items: [] as WheelRow[] })),
    // Dynamiska kategorier per tenant (§ 30) — fail-soft till defaults, men
    // `source` säger OM de kom från databasen så UI:t kan degradera synligt.
    loadAnnualWheelCategories(pb, user.tenant)
  ]);

  const categories = loadedCategories.categories;
  const fallbackCategory = categories[0]?.id ?? 'gemensamt';

  // Normalisera till den rena domäntypen (saneras + defaultas).
  const items: AnnualWheelItem[] = res.items.map((r) => ({
    id: r.id,
    tenant: r.tenant,
    year: typeof r.year === 'number' ? r.year : Number(r.year) || new Date().getFullYear(),
    title: r.title || '(namnlös)',
    month: sanitizeMonth(r.month),
    day: sanitizeDay(r.day),
    track: isAnnualWheelTrack(r.track) ? r.track : 'ovrigt',
    // Kategorin är fri text (dynamisk lista). En post som pekar på en raderad
    // kategori behåller sin nyckel — vyn visar den då rått med neutral färg.
    category: typeof r.category === 'string' && r.category ? r.category : fallbackCategory,
    notes: r.notes || undefined,
    created_by: r.created_by,
    created: r.created,
    updated: r.updated
  }));

  const canEdit = hasRole(user.roles, EDIT_ROLES);
  const canManageCategories = hasRole(user.roles, CATEGORY_MANAGE_ROLES);

  return (
    <PageShell
      title="Årshjul"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          Movexums verksamhetskalender · {items.length} aktiviteter
        </span>
      }
    >
      <AnnualWheelView
        items={items}
        categories={categories}
        categoriesEditable={loadedCategories.editable}
        categoriesSource={loadedCategories.source}
        canEdit={canEdit}
        canManageCategories={canManageCategories}
      />
    </PageShell>
  );
}
