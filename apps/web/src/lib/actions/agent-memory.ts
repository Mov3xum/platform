'use server';

import PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { revalidatePath } from 'next/cache';

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
};

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
    created_by: user.id,
    updated_by: user.id
  };

  try {
    await pb.collection(COLLECTION).create(payload);
  } catch (err) {
    const su = await getSuperuserPb();
    if (su) {
      try {
        await su.collection(COLLECTION).create(payload);
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

  revalidatePath('/installningar');
  return { success: true };
}

/** Uppdaterar innehållet i en befintlig minnesnotering (nyckeln är låst). */
export async function updateAgentMemoryAction(
  id: string,
  content: string
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
  if (!(await assertInTenant(pb, id, user.tenant))) {
    return { error: 'Noteringen finns inte i din tenant.' };
  }

  const patch = { content: next, updated_by: user.id };
  try {
    await pb.collection(COLLECTION).update(id, patch);
  } catch (err) {
    const su = await getSuperuserPb();
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

  revalidatePath('/installningar');
  return { success: true };
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
  return { success: true };
}
