'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createAnnualWheelSeries,
  logAgentAction,
  schemaDriftMessage,
  updateAnnualWheelItemField,
  type AnnualWheelWritableField
} from '@/lib/core/write';
import type { Actor } from '@/lib/core/write';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  ensureAnnualWheelSchema,
  unrepairableDriftMessage,
  type EnsureSchemaOutcome
} from '@/lib/annual-wheel/schema-repair';
import {
  ensureAnnualWheelCategoriesMaterialized,
  listAnnualWheelCategories
} from '@/lib/annual-wheel/categories';
import {
  ANNUAL_WHEEL_CATEGORY_LABEL_MAX,
  DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN,
  isAnnualWheelColorToken,
  slugifyAnnualWheelCategoryKey,
  type AnnualWheelCategoryDef,
  type Role
} from '@platform/shared';

export interface AnnualWheelActionState {
  ok?: boolean;
  error?: string;
  /** Icke-blockerande varning (t.ex. schemat saknar fält). */
  warning?: string;
  /** Antal skapade aktiviteter (> 1 när en serie skapats). */
  created?: number;
  /** Positiv kvittens (t.ex. att schemat reparerades automatiskt). */
  notice?: string;
}

/**
 * Självreparation av schemat FÖRE skrivningen (§ 30): en instans där
 * PocketBase-migrationerna inte körts saknar day/tags/end_*, har `track`
 * obligatoriskt och `category` som select → sparningen avvisas eller tappar
 * fält tyst. Samma mönster som workshops-bildfältet. Fail-soft: utan
 * superuser returneras bara en instruktion till användaren.
 */
async function healSchema(): Promise<{ notice?: string; warning?: string }> {
  let outcome: EnsureSchemaOutcome;
  try {
    outcome = await ensureAnnualWheelSchema();
  } catch (err) {
    console.error('[arshjul] schema self-heal threw', {
      error: err instanceof Error ? err.message : err
    });
    return {};
  }
  if (outcome.status === 'repaired') {
    const r = outcome.result;
    const parts = [`Databasschemat för årshjulet uppdaterades automatiskt (${r.repaired.join(', ')}).`];
    if (r.failedCategories > 0) {
      parts.push(
        `${r.failedCategories} aktivitet(er) kunde inte få tillbaka sin kategori — kontrollera dem i listan.`
      );
    }
    return { notice: parts.join(' ') };
  }
  if (outcome.status === 'drift_unrepairable') {
    return { warning: unrepairableDriftMessage(outcome.drift, outcome.reason) };
  }
  return {};
}

/** Manuell reparation från bannern på /arshjul (admin/incubator_lead). */
export async function repairAnnualWheelSchemaAction(): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) return { error: 'Åtkomst nekad.' };
  const outcome = await ensureAnnualWheelSchema({ force: true });
  if (outcome.status === 'repaired') {
    revalidate();
    return {
      ok: true,
      notice: `Schemat reparerat (${outcome.result.repaired.join(', ') || 'inget behövde ändras'}).`
    };
  }
  if (outcome.status === 'healthy') return { ok: true, notice: 'Schemat är redan uppdaterat.' };
  if (outcome.status === 'drift_unrepairable') {
    return { error: unrepairableDriftMessage(outcome.drift, outcome.reason) };
  }
  return {
    error:
      'Kunde inte läsa schemat — superuser-credentials (POCKETBASE_SUPERUSER_EMAIL/PASSWORD) saknas eller är fel.'
  };
}

const EDIT_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

/** Kollektionens NAMN — aldrig custom-id:t (se kommentar i core/write). */
const COLLECTION = 'annual_wheel_items';

/**
 * Kategorier styrs BARA av superadmin — plattformens `admin`-roll (den högsta
 * app-rollen, CLAUDE.md § 6). Speglas i PB-reglerna för
 * `annual_wheel_categories` (update/delete, migration 1700000139).
 */
const CATEGORY_MANAGE_ROLES: Role[] = ['admin'];

function revalidate() {
  revalidatePath('/arshjul');
}

function userActor(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/**
 * Superuser-klient som skrivlagret får falla tillbaka på när PB v0.23.4:s
 * rule-eval tyst nekar en behörig staff-användare (samma mönster som
 * de minimis § 20.5 och education_documents § 18.3). Rollen är redan
 * verifierad i actionen innan fallbacken kan användas; saknas credentials
 * returneras null och det ursprungliga felet bubblar upp.
 */
async function superuserPb(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[arshjul] superuser unavailable — ingen fallback', { reason: su.reason });
    return null;
  }
  return su.pb;
}

/**
 * Skapar en årshjuls-post (manuellt via /arshjul). Validering, tenant-stämpel
 * och audit ligger i det delade skrivlagret — samma kärna som chatt-agenten
 * använder, så reglerna kan aldrig divergera (CLAUDE.md § 16).
 */
export async function createAnnualWheelItemAction(input: {
  year: number;
  title: string;
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  tags?: string[];
  category: string;
  responsible?: string | null;
  notes?: string;
  /** 'none' | 'monthly' | 'bimonthly' | 'quarterly' — skapar en hel serie. */
  repeat?: string;
  /** Sista månad serien får sträcka sig till (default december). */
  repeatUntilMonth?: number | null;
}): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };

  const heal = await healSchema();
  const pb = await getServerPb();
  const result = await createAnnualWheelSeries(
    pb,
    userActor(user),
    {
      year: input.year,
      title: input.title,
      month: input.month ?? null,
      day: input.day ?? null,
      end_month: input.end_month ?? null,
      end_day: input.end_day ?? null,
      tags: input.tags ?? [],
      category: input.category,
      responsible: input.responsible ?? null,
      notes: input.notes,
      repeat: input.repeat,
      repeat_until_month: input.repeatUntilMonth ?? 12
    },
    { fallbackPb: superuserPb }
  );
  if (!result.ok) {
    console.error('[arshjul] create failed', { tenant: user.tenant, error: result.error });
    return { error: result.error };
  }

  revalidate();
  const missing = result.value.schemaMissing ?? [];
  const created = result.value.created;
  const warning = missing.length > 0 ? schemaDriftMessage(missing) : heal.warning;
  return {
    ok: true,
    created,
    ...(warning ? { warning } : {}),
    ...(heal.notice ? { notice: heal.notice } : {})
  };
}

/** Uppdaterar ETT fält på en årshjuls-post. */
export async function updateAnnualWheelItemAction(
  itemId: string,
  field: AnnualWheelWritableField,
  value: unknown
): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };

  const heal = await healSchema();
  const pb = await getServerPb();
  const result = await updateAnnualWheelItemField(
    pb,
    userActor(user),
    { itemId, field, value },
    { fallbackPb: superuserPb }
  );
  if (!result.ok) {
    console.error('[arshjul] update failed', { tenant: user.tenant, field, error: result.error });
    return { error: result.error };
  }

  revalidate();
  return {
    ok: true,
    ...(heal.warning ? { warning: heal.warning } : {}),
    ...(heal.notice ? { notice: heal.notice } : {})
  };
}

/** Raderar en årshjuls-post (tenant-verifierad). */
export async function deleteAnnualWheelItemAction(itemId: string): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!itemId) return { error: 'Post saknas.' };

  const pb = await getServerPb();
  try {
    const row = await pb
      .collection(COLLECTION)
      .getOne<{ tenant: string }>(itemId, { fields: 'id,tenant' });
    if (String(row.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Posten hittades inte.' };
  }

  try {
    await pb.collection(COLLECTION).delete(itemId);
  } catch (err) {
    // Rule-eval kan neka en behörig staff-användare (§ 21.3) → superuser.
    const su = await superuserPb();
    if (!su) {
      console.error('[arshjul] delete failed', {
        tenant: user.tenant,
        error: err instanceof Error ? err.message : err
      });
      return { error: 'Kunde inte radera posten.' };
    }
    try {
      await su.collection(COLLECTION).delete(itemId);
    } catch (suErr) {
      console.error('[arshjul] delete failed (superuser)', {
        tenant: user.tenant,
        error: suErr instanceof Error ? suErr.message : suErr
      });
      return { error: 'Kunde inte radera posten.' };
    }
  }

  revalidate();
  return { ok: true };
}

// ─── Kategorier (superadmin) ─────────────────────────────────────────────────
//
// Kategorierna är dynamiska per tenant (§ 30). Bara superadmin (`admin`) får
// lägga till, byta namn/färg eller ta bort dem — övrig staff väljer bland de
// befintliga när de skapar aktiviteter. Verifieras här i server-actionen (som
// är säkerhetsgränsen) OCH i PB:s update/delete-regler.

const CATEGORY_COLLECTION = 'annual_wheel_categories';

/**
 * Kör en skrivning som den inloggade; faller tillbaka på superuser vid
 * 400/403 (PB v0.23.4:s rule-eval-quirks, § 21.3). Rollen är redan verifierad
 * av anroparen — fallbacken är robusthet, inte en behörighetsgenväg.
 */
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err ? Number((err as { status: unknown }).status) : 0;
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (!su.ok) throw err;
      return await run(su.pb);
    }
    throw err;
  }
}

async function requireCategoryAdmin(): Promise<
  | { ok: true; user: { id: string; tenant: string; roles: Role[] }; pb: PocketBase }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Ej inloggad.' };
  if (!hasRole(user.roles, CATEGORY_MANAGE_ROLES)) {
    return { ok: false, error: 'Bara superadmin får hantera årshjulets kategorier.' };
  }
  if (!user.tenant) return { ok: false, error: 'Tenant saknas.' };
  const pb = await getServerPb();
  return { ok: true, user, pb };
}

/** Hämtar en kategori-rad och verifierar tenant. */
async function loadCategoryRecord(
  pb: PocketBase,
  tenant: string,
  recordId: string
): Promise<{ ok: true; row: { id: string; key: string; label: string } } | { ok: false; error: string }> {
  if (!recordId) return { ok: false, error: 'Kategori saknas.' };
  try {
    const row = await pb
      .collection(CATEGORY_COLLECTION)
      .getOne<{ id: string; tenant: string; key: string; label: string }>(recordId, {
        fields: 'id,tenant,key,label'
      });
    if (String(row.tenant) !== tenant) return { ok: false, error: 'Åtkomst nekad.' };
    return { ok: true, row: { id: row.id, key: row.key, label: row.label } };
  } catch {
    return { ok: false, error: 'Kategorin hittades inte.' };
  }
}

export interface AnnualWheelCategoryActionState extends AnnualWheelActionState {
  /** Den skapade/ändrade kategorins nyckel (så UI:t kan förvälja den). */
  key?: string;
}

/**
 * Lägger till en kategori (superadmin). Nyckeln härleds ur etiketten
 * ("Ägarmöten" → "agarmoten") och är oföränderlig — befintliga aktiviteter
 * refererar den. Färgen måste vara en Movexum-brand-token (§ 2.2).
 */
export async function createAnnualWheelCategoryAction(input: {
  label: string;
  token: string;
}): Promise<AnnualWheelCategoryActionState> {
  const auth = await requireCategoryAdmin();
  if (!auth.ok) return { error: auth.error };
  const { user, pb } = auth;

  const label = String(input.label ?? '')
    .trim()
    .slice(0, ANNUAL_WHEEL_CATEGORY_LABEL_MAX);
  if (!label) return { error: 'Ange ett namn på kategorin.' };

  const key = slugifyAnnualWheelCategoryKey(label);
  if (!key) return { error: 'Namnet måste innehålla minst en bokstav eller siffra.' };

  const token = isAnnualWheelColorToken(input.token) ? input.token : DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN;

  // Befintliga kategorier: unik nyckel + nästa sort_order. Har tenanten inga
  // rader alls materialiseras defaults först, så de inte tappas när den första
  // egna kategorin läggs till.
  const existing = await ensureAnnualWheelCategoriesMaterialized(pb, user.tenant, user.id);
  if (existing.some((c) => c.id === key)) {
    return { error: `Kategorin "${label}" finns redan.` };
  }
  const nextSort =
    existing.reduce((max, c) => Math.max(max, typeof c.sortOrder === 'number' ? c.sortOrder : 0), -1) + 1;

  let createdId: string;
  try {
    const created = await writeWithFallback(pb, (client) =>
      client.collection(CATEGORY_COLLECTION).create<{ id: string }>({
        tenant: user.tenant,
        key,
        label,
        token,
        sort_order: Math.min(999, nextSort),
        created_by: user.id
      })
    );
    createdId = created.id;
  } catch (err) {
    console.error('[annual-wheel] category create failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte skapa kategorin.' };
  }

  await logAgentAction(pb, {
    actor: userActor(user),
    action_type: 'create',
    collection: CATEGORY_COLLECTION,
    record_id: createdId,
    after_value: { key, label, token }
  });

  revalidate();
  return { ok: true, key };
}

/** Byter namn/färg/ordning på en kategori (superadmin). Nyckeln är låst. */
export async function updateAnnualWheelCategoryAction(
  recordId: string,
  input: { label?: string; token?: string; sortOrder?: number }
): Promise<AnnualWheelCategoryActionState> {
  const auth = await requireCategoryAdmin();
  if (!auth.ok) return { error: auth.error };
  const { user, pb } = auth;

  const found = await loadCategoryRecord(pb, user.tenant, recordId);
  if (!found.ok) return { error: found.error };

  const payload: Record<string, unknown> = {};
  if (input.label !== undefined) {
    const label = String(input.label).trim().slice(0, ANNUAL_WHEEL_CATEGORY_LABEL_MAX);
    if (!label) return { error: 'Ange ett namn på kategorin.' };
    payload.label = label;
  }
  if (input.token !== undefined) {
    if (!isAnnualWheelColorToken(input.token)) return { error: 'Ogiltig färg.' };
    payload.token = input.token;
  }
  if (input.sortOrder !== undefined) {
    const n = Number(input.sortOrder);
    if (!Number.isFinite(n) || n < 0 || n > 999) return { error: 'Ogiltig ordning.' };
    payload.sort_order = Math.trunc(n);
  }
  if (Object.keys(payload).length === 0) return { ok: true, key: found.row.key };

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(CATEGORY_COLLECTION).update(recordId, payload)
    );
  } catch (err) {
    console.error('[annual-wheel] category update failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte uppdatera kategorin.' };
  }

  await logAgentAction(pb, {
    actor: userActor(user),
    action_type: 'update',
    collection: CATEGORY_COLLECTION,
    record_id: recordId,
    after_value: payload
  });

  revalidate();
  return { ok: true, key: found.row.key };
}

/**
 * Tar bort en kategori (superadmin). Blockeras när kategorin används av
 * aktiviteter (de skulle annars tappa sin färg/legend) eller när det är den
 * sista kvarvarande kategorin.
 */
export async function deleteAnnualWheelCategoryAction(
  recordId: string
): Promise<AnnualWheelActionState & { usedBy?: number }> {
  const auth = await requireCategoryAdmin();
  if (!auth.ok) return { error: auth.error };
  const { user, pb } = auth;

  const found = await loadCategoryRecord(pb, user.tenant, recordId);
  if (!found.ok) return { error: found.error };

  const categories = await listAnnualWheelCategories(pb, user.tenant);
  if (categories.length <= 1) {
    return { error: 'Årshjulet måste ha minst en kategori.' };
  }

  // Används kategorin av någon aktivitet? Då krävs omkategorisering först.
  try {
    const used = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter('tenant = {:tenant} && category = {:key}', {
        tenant: user.tenant,
        key: found.row.key
      }),
      fields: 'id'
    });
    if (used.totalItems > 0) {
      return {
        error: `Kategorin används av ${used.totalItems} aktivitet(er). Flytta dem till en annan kategori först.`,
        usedBy: used.totalItems
      };
    }
  } catch {
    return { error: 'Kunde inte kontrollera om kategorin används.' };
  }

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(CATEGORY_COLLECTION).delete(recordId)
    );
  } catch (err) {
    console.error('[annual-wheel] category delete failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort kategorin.' };
  }

  await logAgentAction(pb, {
    actor: userActor(user),
    action_type: 'update',
    collection: CATEGORY_COLLECTION,
    record_id: recordId,
    before_value: { key: found.row.key, label: found.row.label },
    after_value: { deleted: true }
  });

  revalidate();
  return { ok: true };
}

/** Läser tenantens kategorier (för klienten efter en ändring). */
export async function listAnnualWheelCategoriesAction(): Promise<{
  categories: AnnualWheelCategoryDef[];
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { categories: [], error: 'Ej inloggad.' };
  const pb = await getServerPb();
  return { categories: await listAnnualWheelCategories(pb, user.tenant) };
}
