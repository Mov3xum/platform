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

/**
 * Varför listan är fallback-defaults i stället för tenantens egna rader:
 * `missing_schema` = kollektionen finns inte i PB (migration 1700000139 är inte
 * körd på instansen), `unreadable` = läsningen nekades/fallerade, `empty` =
 * kollektionen finns men tenanten har inga rader ännu.
 */
export type AnnualWheelCategorySource = 'db' | 'missing_schema' | 'unreadable' | 'empty';

export interface LoadedAnnualWheelCategories {
  categories: AnnualWheelCategoryDef[];
  source: AnnualWheelCategorySource;
  /** Redigerbara kategorier kräver riktiga PB-rader. */
  editable: boolean;
}

/**
 * Läser tenantens kategorier och SÄGER om de kom från databasen eller är
 * inbyggda defaults. Utan den skillnaden blir ett omigrerat schema en tyst
 * gåta i UI:t ("Kunde inte skapa kategorin") — samma princip som § 24.4:
 * degradera synligt, inte tyst.
 */
export async function loadAnnualWheelCategories(
  pb: PocketBase,
  tenantId: string
): Promise<LoadedAnnualWheelCategories> {
  const fallback = (source: AnnualWheelCategorySource): LoadedAnnualWheelCategories => ({
    categories: [...DEFAULT_ANNUAL_WHEEL_CATEGORIES],
    source,
    editable: false
  });
  if (!tenantId) return fallback('unreadable');
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.annualWheelCategories)
      .getList<CategoryRow>(1, ANNUAL_WHEEL_CATEGORY_PAGE_SIZE, {
        filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
        sort: 'sort_order,label'
      });
    if (res.items.length === 0) return fallback('empty');
    return { categories: resolveAnnualWheelCategories(res.items), source: 'db', editable: true };
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err ? Number((err as { status: unknown }).status) : 0;
    if (status === 404) {
      console.error('[annual-wheel] annual_wheel_categories saknas i PB — migration 1700000139 är inte körd');
      return fallback('missing_schema');
    }
    console.error('[annual-wheel] kunde inte läsa kategorier', {
      status,
      error: err instanceof Error ? err.message : err
    });
    return fallback('unreadable');
  }
}

export async function listAnnualWheelCategories(
  pb: PocketBase,
  tenantId: string
): Promise<AnnualWheelCategoryDef[]> {
  const loaded = await loadAnnualWheelCategories(pb, tenantId);
  return loaded.categories;
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
  const loaded = await loadAnnualWheelCategories(pb, tenantId);
  // Kollektionen saknas/oläsbar → inget att materialisera (anroparen rapporterar).
  if (loaded.source !== 'empty') return loaded.categories;

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
