import 'server-only';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_ANNUAL_WHEEL_CATEGORIES,
  resolveAnnualWheelCategories,
  type AnnualWheelCategoryDef
} from '@platform/shared';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';

/**
 * Årshjulets DYNAMISKA kategorier (CLAUDE.md § 30).
 *
 * En läsväg som delas av sidan (`/arshjul`), server-actions och det delade
 * skrivlagret — så att människa och agent alltid validerar mot exakt samma
 * lista. Läsningen är tenant-filtrerad och går via den pb-instans anroparen
 * skickar in (användarens auth-token på sid-/action-vägen → PB-RLS gäller,
 * § 21).
 *
 * Fail-soft: saknas kollektionen (instans som inte migrerats) eller är den tom
 * returneras de inbyggda defaults, så hjulet aldrig blir legend-/färglöst.
 * Riskklass n/a — ingen AI-inferens, ingen PII.
 */

interface CategoryRow {
  id: string;
  key?: string;
  label?: string;
  token?: string;
  sort_order?: number;
}

export const ANNUAL_WHEEL_CATEGORY_PAGE_SIZE = 200;

export async function listAnnualWheelCategories(
  pb: PocketBase,
  tenantId: string
): Promise<AnnualWheelCategoryDef[]> {
  if (!tenantId) return [...DEFAULT_ANNUAL_WHEEL_CATEGORIES];
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.annualWheelCategories)
      .getList<CategoryRow>(1, ANNUAL_WHEEL_CATEGORY_PAGE_SIZE, {
        filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
        sort: 'sort_order,label'
      });
    return resolveAnnualWheelCategories(res.items);
  } catch {
    return [...DEFAULT_ANNUAL_WHEEL_CATEGORIES];
  }
}

/**
 * Giltiga kategorinycklar för en tenant (för validering av skrivningar).
 * Samma fail-soft-fallback som ovan → en omigrerad instans kan fortfarande
 * skapa poster med default-kategorierna.
 */
export async function listAnnualWheelCategoryKeys(
  pb: PocketBase,
  tenantId: string
): Promise<string[]> {
  const categories = await listAnnualWheelCategories(pb, tenantId);
  return categories.map((c) => c.id);
}

/**
 * Materialiserar default-kategorierna som riktiga rader om tenanten inte har
 * NÅGON rad (t.ex. om migrationens seed inte hann köra). Utan detta skulle den
 * första manuellt tillagda kategorin bli tenantens enda — och befintliga
 * aktiviteter på `styrelse`/`ledning`/`gemensamt` tappa sin legend.
 *
 * Anropas bara från superadmins kategori-flöde (aldrig på läsvägen).
 * Best-effort: misslyckas skrivningen returneras den fail-softa listan.
 */
export async function ensureAnnualWheelCategoriesMaterialized(
  pb: PocketBase,
  tenantId: string,
  createdBy?: string
): Promise<AnnualWheelCategoryDef[]> {
  if (!tenantId) return [...DEFAULT_ANNUAL_WHEEL_CATEGORIES];
  let rowCount = 0;
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.annualWheelCategories)
      .getList<CategoryRow>(1, 1, {
        filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
        fields: 'id'
      });
    rowCount = res.totalItems;
  } catch {
    // Kollektionen saknas (omigrerad instans) → inget att materialisera.
    return [...DEFAULT_ANNUAL_WHEEL_CATEGORIES];
  }
  if (rowCount > 0) return listAnnualWheelCategories(pb, tenantId);

  for (const def of DEFAULT_ANNUAL_WHEEL_CATEGORIES) {
    try {
      await pb.collection(PB_COLLECTIONS.annualWheelCategories).create({
        tenant: tenantId,
        key: def.id,
        label: def.label,
        token: def.token,
        sort_order: def.sortOrder ?? 0,
        ...(createdBy ? { created_by: createdBy } : {})
      });
    } catch (err) {
      console.error('[annual-wheel] default category seed failed', {
        tenant: tenantId,
        key: def.id,
        error: err instanceof Error ? err.message : err
      });
    }
  }
  return listAnnualWheelCategories(pb, tenantId);
}
