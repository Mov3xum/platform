import { getPublicPbUrl } from './pb-url';

// Builds a public URL for a (non-protected) PocketBase file field. Returns null
// when the record has no file. `thumb` requests a server-generated thumbnail
// (must match a size declared on the field, e.g. "800x450").
export function pbFileUrl(
  collection: string,
  recordId: string,
  filename?: string | null,
  thumb?: string
): string | null {
  if (!filename) return null;
  const base = getPublicPbUrl().replace(/\/$/, '');
  const url = `${base}/api/files/${collection}/${recordId}/${encodeURIComponent(filename)}`;
  return thumb ? `${url}?thumb=${thumb}` : url;
}
