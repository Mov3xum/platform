import 'server-only';
import type PocketBase from 'pocketbase';
import type { RenderedDocument } from './types';
import type { GeneratedFileRef, UserFileDocKind } from '@platform/shared';
import { createUserFileRecord } from '@/lib/user-files.server';

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
  const blob = new Blob([new Uint8Array(rendered.buffer)], { type: rendered.mime });
  // Delad skrivväg (superuser-fallback vid PB v0.23.4:s tysta rule-nekande,
  // § 21.3) — samma som uppladdningen i /filer. owner/tenant kommer från
  // anroparen som redan är den inloggade ägaren (eller superuser i bakgrund).
  const rec = await createUserFileRecord(
    p.pb,
    { id: p.ownerUserId, tenant: p.tenant },
    {
      file: blob,
      filename: rendered.filename,
      mime: rendered.mime,
      sizeBytes: rendered.buffer.length,
      source: 'agent_generated',
      docKind: p.docKind,
      extra: { chat_thread: p.chatThreadId, tool_run: p.toolRunId }
    }
  );
  return {
    user_file_id: rec.id,
    filename: rendered.filename,
    mime: rendered.mime,
    doc_kind: p.docKind,
    size_bytes: rendered.buffer.length,
    ...(rendered.previewSvg ? { preview_svg: rendered.previewSvg } : {})
  };
}
