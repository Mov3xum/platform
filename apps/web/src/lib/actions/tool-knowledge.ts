'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { requireRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { extractKnowledgeFromFile, KnowledgeError } from '@/lib/ai/knowledge';
import type { Tool } from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead'] as const;

export type KnowledgeActionState = {
  error?: string;
  ok?: boolean;
};

/**
 * Laddar upp en referensfil till en agents kunskapsbas. Staff-only.
 * Texten extraheras + saneras + cappas server-side (lib/ai/knowledge.ts) och
 * cachas i `tool_knowledge.extracted_text`. Originalfilen lagras tenant-
 * isolerat i `file`-fältet.
 */
export async function addToolKnowledgeAction(
  _prev: KnowledgeActionState,
  formData: FormData
): Promise<KnowledgeActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  const toolId = String(formData.get('toolId') || '').trim();
  const title = String(formData.get('title') || '').trim();
  const fileEntry = formData.get('file');

  if (!toolId) return { error: 'Saknar agent-ID.' };
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return { error: 'Välj en fil att ladda upp.' };
  }

  // Verifiera att agenten finns och tillhör tenanten (tenant-isolation).
  let tool: Tool;
  try {
    tool = await pb.collection('tools').getOne<Tool>(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }
  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  // Extrahera + sanera + cappa text.
  let extracted;
  try {
    extracted = await extractKnowledgeFromFile(fileEntry);
  } catch (err) {
    if (err instanceof KnowledgeError) return { error: err.message };
    return {
      error: err instanceof Error ? err.message : 'Kunde inte läsa filen.'
    };
  }

  // Nästa sort_order = antal befintliga rader.
  let sortOrder = 0;
  try {
    const existing = await pb.collection('tool_knowledge').getList(1, 1, {
      filter: `tool = "${escFilter(toolId)}" && tenant = "${escFilter(user.tenant)}"`,
      fields: 'id'
    });
    sortOrder = existing.totalItems;
  } catch {
    /* fail-soft: börja på 0 */
  }

  const payload = new FormData();
  payload.append('tenant', user.tenant);
  payload.append('tool', toolId);
  payload.append('title', title || extracted.filename);
  payload.append('filename', extracted.filename);
  payload.append('mime', extracted.mime);
  payload.append('size_bytes', String(extracted.sizeBytes));
  payload.append('extracted_text', extracted.text);
  payload.append('char_count', String(extracted.charCount));
  payload.append('redacted', extracted.redacted ? 'true' : 'false');
  payload.append('sort_order', String(sortOrder));
  payload.append('created_by', user.id);
  payload.append('file', fileEntry, extracted.filename);

  try {
    await pb.collection('tool_knowledge').create(payload);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte spara filen.'
    };
  }

  revalidatePath(`/toolbox/${toolId}/edit`);
  revalidatePath(`/toolbox/${toolId}`);
  return { ok: true };
}

/**
 * Tar bort en referensfil ur en agents kunskapsbas. Staff-only, tenant-scoped.
 */
export async function deleteToolKnowledgeAction(
  knowledgeId: string
): Promise<KnowledgeActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  let row: Record<string, unknown> & { tenant?: string; tool?: string };
  try {
    row = (await pb.collection('tool_knowledge').getOne(knowledgeId)) as typeof row;
  } catch {
    return { error: 'Filen hittades inte.' };
  }
  if (row.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection('tool_knowledge').delete(knowledgeId);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte radera filen.'
    };
  }

  if (row.tool) {
    revalidatePath(`/toolbox/${row.tool}/edit`);
    revalidatePath(`/toolbox/${row.tool}`);
  }
  return { ok: true };
}
