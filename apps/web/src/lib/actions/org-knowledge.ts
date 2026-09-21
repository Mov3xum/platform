'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { requireRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { indexOrgKnowledge } from '@/lib/ai/rag';
import { logIndexUsage } from '@/lib/ai/usage';
import type { OrgKnowledge, Role } from '@platform/shared';

// Server actions för den tenant-breda kunskapsbasen (§ 26). Uppladdning sker via
// route handlern /api/knowledge (slipper bodySizeLimit); här ligger lista,
// radera och omindexera. Staff-only (rollen enforce:as här — PB-createRule är
// roll-lös per § 21.3).

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export interface OrgKnowledgeListItem {
  id: string;
  title: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  topic?: string;
  indexed?: boolean;
  chunk_count?: number;
  redacted?: boolean;
  char_count?: number;
  created: string;
}

export interface OrgKnowledgeActionResult {
  error?: string;
  ok?: boolean;
}

function toListItem(r: OrgKnowledge): OrgKnowledgeListItem {
  return {
    id: r.id,
    title: r.title || r.filename,
    filename: r.filename,
    mime: r.mime,
    size_bytes: r.size_bytes,
    topic: r.topic,
    indexed: r.indexed,
    chunk_count: r.chunk_count,
    redacted: r.redacted,
    char_count: r.char_count,
    created: r.created
  };
}

export async function listOrgKnowledgeAction(): Promise<OrgKnowledgeListItem[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  const params = {
    filter: `tenant = "${escFilter(user.tenant)}"`,
    fields: 'id,title,filename,mime,size_bytes,topic,indexed,chunk_count,redacted,char_count,created'
  };
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.orgKnowledge)
      .getList<OrgKnowledge>(1, 200, { ...params, sort: '-created' });
    return res.items.map(toListItem);
  } catch {
    // Schemat kan sakna `created` (kollektion skapad innan migration
    // 1700000125) → sorteringen 400:ar. Lista då osorterat och vänd ordningen
    // (PB:s defaultordning är äldst-först) så uppladdningar aldrig "försvinner".
    try {
      const res = await pb
        .collection(PB_COLLECTIONS.orgKnowledge)
        .getList<OrgKnowledge>(1, 200, params);
      return res.items.map(toListItem).reverse();
    } catch {
      return [];
    }
  }
}

export async function deleteOrgKnowledgeAction(id: string): Promise<OrgKnowledgeActionResult> {
  const user = await requireUser();
  requireRole(user.roles, STAFF_ROLES);
  const pb = await getServerPb();
  try {
    const rec = (await pb.collection(PB_COLLECTIONS.orgKnowledge).getOne(id)) as unknown as OrgKnowledge;
    if (rec.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    // Chunkar cascade-raderas via source-relationen (cascadeDelete=true).
    await pb.collection(PB_COLLECTIONS.orgKnowledge).delete(id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera filen.' };
  }
  revalidatePath('/kunskapsbas');
  return { ok: true };
}

/**
 * Bygger om RAG-indexet för en fil ur dess redan extraherade text. Användbart
 * om en tidigare indexering fallerade (filen är då sökbar via nyckelords-
 * fallback men inte semantiskt).
 */
export async function reindexOrgKnowledgeAction(id: string): Promise<OrgKnowledgeActionResult> {
  const user = await requireUser();
  requireRole(user.roles, STAFF_ROLES);
  const pb = await getServerPb();
  let rec: OrgKnowledge;
  try {
    rec = (await pb.collection(PB_COLLECTIONS.orgKnowledge).getOne(id)) as unknown as OrgKnowledge;
  } catch {
    return { error: 'Filen hittades inte.' };
  }
  if (rec.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
  const text = String(rec.extracted_text ?? '');
  if (!text.trim()) return { error: 'Filen saknar extraherad text att indexera.' };
  try {
    const idx = await indexOrgKnowledge(pb, { tenant: user.tenant, sourceId: id, text });
    void logIndexUsage(pb, { tenant: user.tenant, userId: user.id }, idx.usage);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte indexera om filen.' };
  }
  revalidatePath('/kunskapsbas');
  return { ok: true };
}
