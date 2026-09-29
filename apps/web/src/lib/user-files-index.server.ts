import 'server-only';
import type PocketBase from 'pocketbase';
import type { UserFile } from '@platform/shared';
import { getServerPbUrl } from '@/lib/pb-url';
import { extractPdfText, extractXlsxText, extractDocxText, extractPptxText } from '@/lib/ai/attachments';
import { indexUserFile } from '@/lib/ai/rag';
import { logIndexUsage } from '@/lib/ai/usage';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';

/**
 * Delad extraktion + RAG-indexering av ÄGARENS personliga filer (§ 27).
 *
 * Bakgrund (incident 2026-09): uppladdningsrouten `/api/filer` och
 * server-actionen i `lib/actions/files.ts` hade varsin kopia av extraktionen,
 * och routens kopia kunde bara PDF/Excel/text — PowerPoint/Word som laddades
 * upp via /filer fick `indexed:false` utan text, och "Gör sökbara i chatten"
 * hoppade dessutom över dem i sitt PB-filter. Chatten kunde då aldrig hitta en
 * fil som tydligt låg i Filer. Den här modulen är nu ENDA vägen: en
 * format-lista, ett PB-filter och en indexerare, delad av route och action.
 */

/** Mime-typer vi läser som ren text (utdrag för kategorisering + RAG). */
export const USER_FILE_TEXT_MIMES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv'
]);

/**
 * PB-filter som plockar ut filer vi kan extrahera text ur — MÅSTE spegla
 * `extractableUserFileKinds` nedan (samma format i frågan som i koden), annars
 * tystnar "Gör sökbara i chatten" för ett format som indexeraren egentligen
 * klarar.
 */
export const EXTRACTABLE_USER_FILE_FILTER =
  '(doc_kind = "pdf" || doc_kind = "xlsx" || doc_kind = "docx" || doc_kind = "pptx" || ' +
  'mime = "application/pdf" || mime ~ "spreadsheetml" || mime = "application/vnd.ms-excel" || ' +
  'mime ~ "wordprocessingml" || mime ~ "presentationml" || ' +
  'mime = "text/plain" || mime = "text/markdown" || mime = "text/csv")';

export interface ExtractableKinds {
  pdf: boolean;
  xlsx: boolean;
  docx: boolean;
  pptx: boolean;
  text: boolean;
}

/** Är filen en av de texttyper vi kan extrahera (pdf/xlsx/docx/pptx/text/csv/md)? */
export function extractableUserFileKinds(
  rec: Pick<UserFile, 'mime' | 'doc_kind'>
): ExtractableKinds | null {
  const mime = (rec.mime || '').toLowerCase();
  const pdf = mime === 'application/pdf' || rec.doc_kind === 'pdf';
  const xlsx =
    mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || rec.doc_kind === 'xlsx';
  const docx = mime.includes('wordprocessingml') || rec.doc_kind === 'docx';
  const pptx = mime.includes('presentationml') || rec.doc_kind === 'pptx';
  const text = USER_FILE_TEXT_MIMES.has(mime);
  if (!pdf && !xlsx && !docx && !pptx && !text) return null;
  return { pdf, xlsx, docx, pptx, text };
}

/** Tak för extraherad text som persisteras + indexeras per personlig fil (§ 27). */
export const RAG_MAX_USER_FILE_CHARS = 300_000;

/**
 * Hämtar filens bytes server-side (kortlivad fil-token) och extraherar text.
 * Cappas till `maxChars`. Fail-soft: returnerar undefined. Texten matas/lagras
 * bara av anroparen (transient för kategorisering, persisterad sanerad för RAG).
 */
export async function extractUserFileText(
  pb: PocketBase,
  rec: UserFile,
  maxChars: number
): Promise<string | undefined> {
  if (!rec.file) return undefined;
  const kinds = extractableUserFileKinds(rec);
  if (!kinds) return undefined;
  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/user_files/${rec.id}/${encodeURIComponent(
      rec.file
    )}?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    let text = '';
    if (kinds.pdf) text = await extractPdfText(buf);
    else if (kinds.xlsx) text = await extractXlsxText(buf);
    else if (kinds.docx) text = await extractDocxText(buf);
    else if (kinds.pptx) text = await extractPptxText(buf);
    else text = buf.toString('utf8');
    return text.slice(0, maxChars).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extraherar, personnummer-sanerar och RAG-indexerar EN av ägarens egna filer
 * så chatten kan köra mot den via `search_my_files`/`read_my_file`. Verifierar
 * owner/tenant. Best-effort: en miss markerar bara filen som ej indexerad.
 * Returnerar antal chunkar (0 = ej indexerbar/ingen text).
 */
export async function extractAndIndexUserFile(
  pb: PocketBase,
  tenant: string,
  ownerId: string,
  fileOrId: string | UserFile
): Promise<number> {
  let rec: UserFile;
  if (typeof fileOrId === 'string') {
    try {
      rec = (await pb.collection('user_files').getOne(fileOrId)) as unknown as UserFile;
    } catch {
      return 0;
    }
  } else {
    rec = fileOrId;
  }
  if (rec.owner !== ownerId || rec.tenant !== tenant) return 0;
  if (!extractableUserFileKinds(rec)) {
    await pb.collection('user_files').update(rec.id, { indexed: false, chunk_count: 0 }).catch(() => {});
    return 0;
  }

  const raw = await extractUserFileText(pb, rec, RAG_MAX_USER_FILE_CHARS);
  if (!raw) {
    await pb.collection('user_files').update(rec.id, { indexed: false, chunk_count: 0 }).catch(() => {});
    return 0;
  }
  // Personnummer-sanering före lagring/indexering (defense-in-depth, samma som
  // kunskapsbasen och CRM-importen). Originalfilen lämnas orörd.
  const text = sanitizePersonnummer(raw);

  try {
    await pb.collection('user_files').update(rec.id, { extracted_text: text });
  } catch {
    /* fail-soft */
  }

  try {
    const idx = await indexUserFile(pb, { tenant, owner: ownerId, sourceId: rec.id, text });
    void logIndexUsage(pb, { tenant, userId: ownerId }, idx.usage);
    return idx.chunkCount;
  } catch {
    return 0;
  }
}
