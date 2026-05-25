import 'server-only';
import type { DocumentSpec, RenderedDocument } from './types';
import { MIME, safeFilename } from './brand';
import { renderPptx } from './render-pptx';
import { renderXlsx } from './render-xlsx';
import { renderDocx } from './render-docx';
import { renderPdf } from './render-pdf';

export type { DocumentSpec, RenderedDocument } from './types';
export { validateDocumentSpec } from './validate';

const EXT: Record<string, string> = { pptx: 'pptx', xlsx: 'xlsx', docx: 'docx', pdf: 'pdf' };

/**
 * Renderar ett validerat DocumentSpec till en fil-buffer. Dispatch på `kind`.
 */
export async function renderDocument(spec: DocumentSpec): Promise<RenderedDocument> {
  let buffer: Buffer;
  switch (spec.kind) {
    case 'pptx':
      buffer = await renderPptx(spec);
      break;
    case 'xlsx':
      buffer = await renderXlsx(spec);
      break;
    case 'docx':
      buffer = await renderDocx(spec);
      break;
    case 'pdf':
      buffer = await renderPdf(spec);
      break;
    default:
      throw new Error(`Okänt dokumentformat: ${spec.kind}`);
  }
  return {
    buffer,
    filename: safeFilename(spec.title, EXT[spec.kind]),
    mime: MIME[spec.kind]
  };
}
