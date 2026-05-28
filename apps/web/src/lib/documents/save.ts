import 'server-only';
import type PocketBase from 'pocketbase';
import type { RenderedDocument } from './types';
import type { GeneratedFileRef, UserFileDocKind } from '@platform/shared';

export interface SaveGeneratedFileParams {
  pb: PocketBase;
  tenant: string;
  ownerUserId: string;
  rendered: RenderedDocument;
  docKind: UserFileDocKind;
  chatThreadId?: string;
  toolRunId?: string;
}

/**
 * Sparar ett renderat dokument i ägarens privata `user_files` (strikt
 * ägaren-bara) och returnerar en GeneratedFileRef för nedladdnings-chip.
 * pb är autentiserad som ägaren i den interaktiva chatten → OWNER_MATCH
 * uppfylls. För bakgrundskörningar (superuser) sätts owner explicit.
 */
export async function saveGeneratedFile(
  p: SaveGeneratedFileParams
): Promise<GeneratedFileRef> {
  const { rendered } = p;
  const fd = new FormData();
  fd.append('tenant', p.tenant);
  fd.append('owner', p.ownerUserId);
  const blob = new Blob([new Uint8Array(rendered.buffer)], { type: rendered.mime });
  fd.append('file', blob, rendered.filename);
  fd.append('filename', rendered.filename);
  fd.append('mime', rendered.mime);
  fd.append('size_bytes', String(rendered.buffer.length));
  fd.append('source', 'agent_generated');
  fd.append('doc_kind', p.docKind);
  if (p.chatThreadId) fd.append('chat_thread', p.chatThreadId);
  if (p.toolRunId) fd.append('tool_run', p.toolRunId);

  const rec = await p.pb.collection('user_files').create(fd);
  return {
    user_file_id: rec.id as string,
    filename: rendered.filename,
    mime: rendered.mime,
    doc_kind: p.docKind,
    size_bytes: rendered.buffer.length
  };
}
