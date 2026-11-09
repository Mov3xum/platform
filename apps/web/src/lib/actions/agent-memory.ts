'use server';

import PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import {
  AGENT_MEMORY_CATEGORY_IDS,
  inferAgentMemoryCategory,
  normalizeAgentMemoryCategory,
  type AgentMemoryCategory
} from '@platform/shared';

// Server actions för det tvärsessions-minne (`agent_memory`, CLAUDE.md § 16.4)
// som AI-chatten lär sig av personalens korrigeringar. Ger admin/incubator_lead
// en plats i Inställningar att SE, REDIGERA och RENSA det modellen lagrat — så
// en felaktig "inlärning" kan rättas eller tas bort, inte bara via PB-admin.
//
// Säkerhet: läs/skriv går via användarens auth-token (getServerPb) → PB:s RLS
// gäller (agent_memory är staff-only + tenant-scope, § 21). Rollen enforce:as
// dessutom här (defense-in-depth). Superuser-fallback täcker en ev. otrasig
// regel-instans (samma mönster som lib/actions/settings.ts).

const COLLECTION = 'agent_memory';
const MAX_KEY = 200;
const MAX_CONTENT = 8000;
const PB_URL = getServerPbUrl();

export type AgentMemoryActionState = {
  error?: string;
  success?: boolean;
  /** Icke-blockerande upplysning (t.ex. schema-drift). */
  warning?: string;
};

const SCHEMA_DRIFT_HINT =
  'PocketBase saknar fältet agent_memory.category (migration 1700000155). ' +
  'Kategorin sparades inte — kör migrationerna eller setup-via-api.mjs mot instansen.';

/**
 * Tolkar kategori-input från formuläret. Tomt → härledd ur nyckel + innehåll
 * (samma deterministiska regel som chatten). Okänt värde → fel, aldrig tyst
 * "övrigt".
 */
function resolveCategoryInput(
  raw: unknown,
  key: string,
  content: string
): { category: AgentMemoryCategory } | { error: string } {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { category: inferAgentMemoryCategory(key, content) };
  const cat = normalizeAgentMemoryCategory(trimmed);
  if (!cat) {
    return { error: `Okänd kategori. Giltiga: ${AGENT_MEMORY_CATEGORY_IDS.join(', ')}.` };
  }
  return { category: cat };
}

/**
 * Läser tillbaka posten och kontrollerar att kategorin faktiskt fastnade —
 * PB släpper okända fält tyst (§ 24.4/§ 30.4-invarianten), så en instans
 * utan migration 1700000155 skulle annars "spara" utan att något ändrades.
 */
async function verifyCategoryPersisted(
  pb: PocketBase,
  su: PocketBase | null,
  id: string,
  expected: AgentMemoryCategory
): Promise<string | undefined> {
  const read = async (client: PocketBase) =>
    client.collection(COLLECTION).getOne<{ category?: unknown }>(id, { fields: 'id,category' });
  try {
    let rec: { category?: unknown };
    try {
      rec = await read(pb);
    } catch {
      if (!su) return undefined; // kan inte verifiera — blockera inte sparandet
      rec = await read(su);
    }
    if (rec.category !== expected) return SCHEMA_DRIFT_HINT;
  } catch {
    /* verifieringen är best-effort */
  }
  return undefined;
}

async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) return null;
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    return null;
  }
}

/** Verifierar att en post finns i användarens tenant innan mutation. */
async function assertInTenant(
  pb: PocketBase,
  id: string,
  tenantId: string
): Promise<boolean> {
  try {
    const rec = await pb.collection(COLLECTION).getOne<{ tenant?: string }>(id, {
      fields: 'id,tenant'
    });
    return rec.tenant === tenantId;
  } catch {
    return false;
  }
}

/**
 * Skapar en ny minnesnotering manuellt (admin lägger in en bestående regel).
 * Tenant-brett som default; valfritt per-bolag-scope via `startup`.
 */
export async function createAgentMemoryAction(
  _prev: AgentMemoryActionState,
  formData: FormData
): Promise<AgentMemoryActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }

  const key = String(formData.get('key') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const startupId = String(formData.get('startup') || '').trim();

  if (!key) return { error: 'Ange en nyckel/rubrik.' };
  if (key.length > MAX_KEY) return { error: `Nyckeln får vara max ${MAX_KEY} tecken.` };
  if (!content) return { error: 'Ange ett innehåll.' };
  if (content.length > MAX_CONTENT) {
    return { error: `Innehållet får vara max ${MAX_CONTENT} tecken.` };
  }
  const cat = resolveCategoryInput(formData.get('category'), key, content);
  if ('error' in cat) return { error: cat.error };

  const pb = await getServerPb();

  // Valfri per-bolag-koppling måste tillhöra tenanten.
  if (startupId) {
    try {
      const s = await pb.collection('startups').getOne<{ tenant?: string }>(startupId, {
        fields: 'id,tenant'
      });
      if (s.tenant !== user.tenant) return { error: 'Bolaget tillhör inte din tenant.' };
    } catch {
      return { error: 'Hittade inte bolaget.' };
    }
  }

  const payload = {
    tenant: user.tenant,
    startup: startupId || '',
    key,
    content,
    category: cat.category,
    created_by: user.id,
    updated_by: user.id
  };

  let createdId = '';
  let su: PocketBase | null = null;
  try {
    const rec = await pb.collection(COLLECTION).create<{ id: string }>(payload);
    createdId = rec.id;
  } catch (err) {
    su = await getSuperuserPb();
    if (su) {
      try {
        const rec = await su.collection(COLLECTION).create<{ id: string }>(payload);
        createdId = rec.id;
      } catch (fallbackErr) {
        // Krockar mot unik-index (tenant, startup, key) → duplikat.
        const msg = fallbackErr instanceof Error ? fallbackErr.message : '';
        if (/unique|exists|duplicate/i.test(msg)) {
          return { error: 'En notering med den nyckeln finns redan (för det scopet).' };
        }
        console.error('[agent-memory] create failed (fallback)', { tenant: user.tenant });
        return { error: 'Kunde inte spara noteringen. Försök igen.' };
      }
    } else {
      const msg = err instanceof Error ? err.message : '';
      if (/unique|exists|duplicate/i.test(msg)) {
        return { error: 'En notering med den nyckeln finns redan (för det scopet).' };
      }
      console.error('[agent-memory] create failed', { tenant: user.tenant });
      return { error: 'Kunde inte spara noteringen. Försök igen.' };
    }
  }

  const warning = createdId
    ? await verifyCategoryPersisted(pb, su, createdId, cat.category)
    : undefined;

  revalidatePath('/installningar');
  revalidatePath('/installningar/ai-minne');
  return { success: true, warning };
}

/**
 * Uppdaterar innehåll och/eller kategori i en befintlig minnesnotering
 * (nyckeln är låst). `category` utelämnad = rör inte kategorin; tom sträng =
 * härled ur nyckel + innehåll.
 */
export async function updateAgentMemoryAction(
  id: string,
  content: string,
  category?: string
): Promise<AgentMemoryActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }
  if (!id) return { error: 'Saknar id.' };
  const next = content.trim();
  if (!next) return { error: 'Innehållet får inte vara tomt.' };
  if (next.length > MAX_CONTENT) {
    return { error: `Innehållet får vara max ${MAX_CONTENT} tecken.` };
  }

  const pb = await getServerPb();
  let existing: { tenant?: string; key?: string } | null = null;
  try {
    existing = await pb
      .collection(COLLECTION)
      .getOne<{ tenant?: string; key?: string }>(id, { fields: 'id,tenant,key' });
  } catch {
    existing = null;
  }
  if (!existing || existing.tenant !== user.tenant) {
    return { error: 'Noteringen finns inte i din tenant.' };
  }

  let resolvedCategory: AgentMemoryCategory | null = null;
  if (category !== undefined) {
    const cat = resolveCategoryInput(category, existing.key ?? '', next);
    if ('error' in cat) return { error: cat.error };
    resolvedCategory = cat.category;
  }

  const patch: Record<string, unknown> = { content: next, updated_by: user.id };
  if (resolvedCategory) patch.category = resolvedCategory;

  let su: PocketBase | null = null;
  try {
    await pb.collection(COLLECTION).update(id, patch);
  } catch (err) {
    su = await getSuperuserPb();
    if (!su) {
      console.error('[agent-memory] update failed', { tenant: user.tenant, id });
      return { error: 'Kunde inte spara ändringen. Försök igen.' };
    }
    try {
      await su.collection(COLLECTION).update(id, patch);
    } catch {
      console.error('[agent-memory] update failed (fallback)', { tenant: user.tenant, id });
      return { error: 'Kunde inte spara ändringen. Försök igen.' };
    }
  }

  const warning = resolvedCategory
    ? await verifyCategoryPersisted(pb, su, id, resolvedCategory)
    : undefined;

  revalidatePath('/installningar');
  revalidatePath('/installningar/ai-minne');
  return { success: true, warning };
}

/**
 * Sätter bara kategorin på en notering (bekräfta en härledd kategori eller
 * flytta noteringen till en annan). Innehållet rörs inte.
 */
export async function setAgentMemoryCategoryAction(
  id: string,
  category: string
): Promise<AgentMemoryActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }
  if (!id) return { error: 'Saknar id.' };
  const cat = normalizeAgentMemoryCategory(category);
  if (!cat) {
    return { error: `Okänd kategori. Giltiga: ${AGENT_MEMORY_CATEGORY_IDS.join(', ')}.` };
  }

  const pb = await getServerPb();
  if (!(await assertInTenant(pb, id, user.tenant))) {
    return { error: 'Noteringen finns inte i din tenant.' };
  }

  const patch = { category: cat, updated_by: user.id };
  let su: PocketBase | null = null;
  try {
    await pb.collection(COLLECTION).update(id, patch);
  } catch {
    su = await getSuperuserPb();
    if (!su) {
      console.error('[agent-memory] set category failed', { tenant: user.tenant, id });
      return { error: 'Kunde inte spara kategorin. Försök igen.' };
    }
    try {
      await su.collection(COLLECTION).update(id, patch);
    } catch {
      console.error('[agent-memory] set category failed (fallback)', { tenant: user.tenant, id });
      return { error: 'Kunde inte spara kategorin. Försök igen.' };
    }
  }

  const drift = await verifyCategoryPersisted(pb, su, id, cat);
  if (drift) return { error: drift };

  revalidatePath('/installningar');
  revalidatePath('/installningar/ai-minne');
  return { success: true, warning: undefined };
}

/** Raderar en minnesnotering. */
export async function deleteAgentMemoryAction(id: string): Promise<AgentMemoryActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }
  if (!id) return { error: 'Saknar id.' };

  const pb = await getServerPb();
  if (!(await assertInTenant(pb, id, user.tenant))) {
    return { error: 'Noteringen finns inte i din tenant.' };
  }

  try {
    await pb.collection(COLLECTION).delete(id);
  } catch (err) {
    const su = await getSuperuserPb();
    if (!su) {
      console.error('[agent-memory] delete failed', { tenant: user.tenant, id });
      return { error: 'Kunde inte ta bort noteringen. Försök igen.' };
    }
    try {
      await su.collection(COLLECTION).delete(id);
    } catch {
      console.error('[agent-memory] delete failed (fallback)', { tenant: user.tenant, id });
      return { error: 'Kunde inte ta bort noteringen. Försök igen.' };
    }
  }

  revalidatePath('/installningar');
  revalidatePath('/installningar/ai-minne');
  return { success: true };
}
