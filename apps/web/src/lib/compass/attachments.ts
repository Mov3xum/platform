import 'server-only';
import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/* ────────────────────────────────────────────────────────────────────
   Bilagor i Startupkompassen (CLAUDE.md § 23.12)
   ────────────────────────────────────────────────────────────────────
   Besökaren laddar upp filer (pitch deck m.m.) i avsnittet "Dina uppgifter"
   INNAN flödet skickas in. Filerna nycklas på flödets sessionstoken (bara
   SHA-256-hashen lagras) + modulens slug + tenant och kopplas till leadet när
   flödet slutförs (`finalizeLead`). Okopplade filer gallras av
   retention_tick efter två dygn. Kollektionen är server-only att skapa
   (createRule null), filen är protected och läses av personalen via en
   tenant-scopad proxy. Denylistad för AI. */

export interface LeadAttachment {
  id: string;
  tenant: string;
  lead?: string;
  module_slug?: string;
  file: string;
  filename?: string;
  mime?: string;
  size_bytes?: number;
  created?: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,100}$/;

export function isValidSessionToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const COLLECTION = 'compass_lead_attachments';

/** Bilagor som laddats upp i en pågående session (ännu inte kopplade eller kopplade). */
export async function listSessionAttachments(
  pb: PocketBase,
  tenant: string,
  moduleSlug: string,
  sessionToken: string
): Promise<LeadAttachment[]> {
  if (!isValidSessionToken(sessionToken)) return [];
  try {
    return await pb.collection(COLLECTION).getFullList<LeadAttachment>({
      filter: pb.filter('tenant = {:t} && module_slug = {:m} && session_hash = {:h}', {
        t: tenant,
        m: moduleSlug,
        h: hashSessionToken(sessionToken)
      }),
      fields: 'id,tenant,lead,module_slug,file,filename,mime,size_bytes,created'
    });
  } catch {
    return [];
  }
}

/**
 * Kopplar sessionens bilagor till leadet. Best-effort per fil — ett fel
 * fäller aldrig lead-garantin (§ 23.6). Skriver via superuser (createRule/
 * updateRule är null; anroparen har redan verifierat modul + tenant).
 */
export async function linkSessionAttachments(
  tenant: string,
  moduleSlug: string,
  sessionToken: string | null | undefined,
  leadId: string
): Promise<number> {
  if (!sessionToken || !isValidSessionToken(sessionToken)) return 0;
  const r = await getSuperuserPb();
  if (!r.ok) return 0;
  const su = r.pb;
  const rows = await listSessionAttachments(su, tenant, moduleSlug, sessionToken);
  let linked = 0;
  for (const row of rows) {
    if (row.tenant !== tenant || row.lead === leadId) continue;
    try {
      await su.collection(COLLECTION).update(row.id, { lead: leadId });
      linked++;
    } catch (err) {
      console.error('[compass] link attachment failed', {
        status: (err as { status?: number })?.status ?? 0
      });
    }
  }
  return linked;
}

/** Antal bilagor i sessionen — server-sidans sanning för "Bilagor krävs". */
export async function countSessionAttachments(
  tenant: string,
  moduleSlug: string,
  sessionToken: string | null | undefined
): Promise<number> {
  if (!sessionToken || !isValidSessionToken(sessionToken)) return 0;
  const r = await getSuperuserPb();
  if (!r.ok) return 0;
  return (await listSessionAttachments(r.pb, tenant, moduleSlug, sessionToken)).length;
}

/** Leadets bilagor (personalens vy) — läses med användarens token (RLS). */
export async function listLeadAttachments(
  pb: PocketBase,
  tenant: string,
  leadId: string
): Promise<LeadAttachment[]> {
  try {
    const rows = await pb.collection(COLLECTION).getFullList<LeadAttachment>({
      filter: pb.filter('tenant = {:t} && lead = {:l}', { t: tenant, l: leadId }),
      sort: 'created',
      fields: 'id,tenant,lead,file,filename,mime,size_bytes,created'
    });
    return rows.filter((r) => r.tenant === tenant);
  } catch {
    return [];
  }
}

/** Antal bilagor på ett lead (notismejlet) — superuser, tenant-filtrerat. */
export async function countLeadAttachments(tenant: string, leadId: string): Promise<number> {
  const r = await getSuperuserPb();
  if (!r.ok) return 0;
  try {
    const res = await r.pb.collection(COLLECTION).getList(1, 1, {
      filter: r.pb.filter('tenant = {:t} && lead = {:l}', { t: tenant, l: leadId }),
      fields: 'id'
    });
    return res.totalItems;
  } catch {
    return 0;
  }
}
