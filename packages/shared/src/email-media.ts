// Bilder i e-postkampanjer (CLAUDE.md § 55.9) — REN modul utan IO, delad av
// editorn (förvalidering i webbläsaren), upload-routen (säkerhetsgränsen),
// normaliseringen av bildblock och renderaren.
//
// Bilden laddas upp som RIKTIG PocketBase-fil i `email_media` och refereras i
// bildblocket med en APP-RELATIV sökväg (`/api/public/e/bild/<id>/<fil>`) som
// den egna origin-proxyn serverar. Mejlklienter kräver absoluta adresser, så
// renderaren absolutiserar sökvägen med utskickets `APP_URL` vid sändning
// (`absolutizeEmailAssetUrl`) — aldrig en inbakad host, så ett domänbyte
// (staging → produktion) aldrig lämnar döda bilder i sparade kampanjer.

/** Bara rasterbilder — SVG kan bära skript och renderas ändå inte av Gmail/Outlook. */
export const EMAIL_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type EmailImageMime = (typeof EMAIL_IMAGE_MIMES)[number];

/** Taket per bild EFTER webbläsarens nedskalning (ett mejl bör ligga under ~1 MB totalt). */
export const EMAIL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Bildens längsta sida vid nedskalning: 520 px i mejlet × 2 för skarpa skärmar. */
export const EMAIL_IMAGE_MAX_EDGE = 1200;

export const EMAIL_MEDIA_PATH_PREFIX = '/api/public/e/bild/';

const EXT_TO_MIME: Record<string, EmailImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

export function resolveEmailImageMime(type: string, name?: string): EmailImageMime | null {
  const t = (type || '').toLowerCase().split(';')[0].trim();
  if ((EMAIL_IMAGE_MIMES as readonly string[]).includes(t)) return t as EmailImageMime;
  // Webbläsaren rapporterar ibland ingen typ (Windows, drag-and-drop) — härled ur ändelsen.
  const ext = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return (t === '' || t === 'application/octet-stream') && EXT_TO_MIME[ext] ? EXT_TO_MIME[ext] : null;
}

export type EmailImageFileValidation = { ok: true; mime: EmailImageMime } | { ok: false; error: string };

/** Förvalidering av en bildfil — klienten innan uppladdning, routen som gräns. */
export function validateEmailImageFile(file: { type: string; size: number; name?: string }): EmailImageFileValidation {
  const mime = resolveEmailImageMime(file.type, file.name);
  if (!mime) return { ok: false, error: 'Filtypen stöds inte i mejl. Välj PNG, JPG, WEBP eller GIF.' };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: 'Filen verkar vara tom.' };
  if (file.size > EMAIL_IMAGE_MAX_BYTES) {
    return { ok: false, error: `Bilden är för stor (max ${Math.round(EMAIL_IMAGE_MAX_BYTES / (1024 * 1024))} MB).` };
  }
  return { ok: true, mime };
}

const ID_RE = /^[a-z0-9]{15}$/;
// PB-filnamn: originalnamn (sanerat av PB) + "_<10 alnum>" + ändelse.
const FILENAME_RE = /^[A-Za-z0-9._-]{1,200}$/;

/** Bygger blockets sökväg ur postens id och PB:s lagrade filnamn. */
export function emailMediaPath(id: string, filename: string): string {
  return `${EMAIL_MEDIA_PATH_PREFIX}${id}/${encodeURIComponent(filename)}`;
}

/** Är värdet en sökväg till en uppladdad kampanjbild (och inget annat)? */
export function isEmailMediaPath(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!v.startsWith(EMAIL_MEDIA_PATH_PREFIX)) return false;
  const rest = v.slice(EMAIL_MEDIA_PATH_PREFIX.length).split('/');
  if (rest.length !== 2) return false;
  const [id, raw] = rest;
  let filename: string;
  try {
    filename = decodeURIComponent(raw);
  } catch {
    return false;
  }
  return ID_RE.test(id) && FILENAME_RE.test(filename);
}

/** Plockar ut postens id ur en kampanjbilds sökväg (för uppstädning/kontroll). */
export function emailMediaIdFromPath(v: string): string | null {
  return isEmailMediaPath(v) ? v.slice(EMAIL_MEDIA_PATH_PREFIX.length).split('/')[0] : null;
}

/**
 * Absolutiserar en app-relativ bildsökväg med utskickets bas-URL. Absoluta
 * adresser lämnas orörda; utan bas returneras sökvägen som den är (editorns
 * förhandsgranskning visas på samma origin och behöver ingen).
 */
export function absolutizeEmailAssetUrl(url: string, base: string | null | undefined): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const b = (base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/i.test(b)) return url;
  return `${b}${url}`;
}
