// Klient-side nedskalning av rasterbilder före uppladdning (webbläsaren,
// canvas). Syfte: en mobilbild på 8–15 MB blir ~200–600 KB WebP/JPEG utan
// synlig kvalitetsförlust på webben — uppladdningen går snabbt, passerar
// proxyns body-tak och den publika sidan laddar snabbt. Ingen dependency.
//
// Fail-soft: kan bilden inte avkodas (HEIC i Firefox, trasig fil) eller är
// den redan liten returneras ORIGINALET oförändrat. GIF (animation) och SVG
// (vektor) rörs aldrig.

export interface ResizeImageOptions {
  /** Längsta sida i pixlar efter nedskalning (default 2400). */
  maxEdge?: number;
  /** Hoppa över när filen redan är mindre än så här många byte (default 900 KB). */
  skipBelowBytes?: number;
  /** Kvalitet 0–1 för WebP/JPEG (default 0.86). */
  quality?: number;
}

const PASSTHROUGH = new Set(['image/gif', 'image/svg+xml']);

export function shouldResizeImage(file: { type: string; size: number }, opts: ResizeImageOptions = {}): boolean {
  const skipBelow = opts.skipBelowBytes ?? 900 * 1024;
  if (!file.type.startsWith('image/')) return false;
  if (PASSTHROUGH.has(file.type)) return false;
  return file.size > skipBelow;
}

export async function resizeImageFile(file: File, opts: ResizeImageOptions = {}): Promise<File> {
  if (typeof window === 'undefined') return file;
  if (!shouldResizeImage(file, opts)) return file;
  const maxEdge = opts.maxEdge ?? 2400;
  const quality = opts.quality ?? 0.86;

  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  try {
    bitmap =
      typeof createImageBitmap === 'function'
        ? await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
        : await loadImageElement(file);
  } catch {
    return file;
  }

  try {
    const w = bitmap.width;
    const h = bitmap.height;
    if (!w || !h) return file;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    // Redan liten nog i pixlar OCH under 3 MB → behåll originalet oförändrat.
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // WebP om webbläsaren kan koda det, annars JPEG. PNG med transparens
    // behålls som PNG (annars blir bakgrunden svart).
    const wantsAlpha = file.type === 'image/png' && hasAlpha(ctx, canvas.width, canvas.height);
    const mime = wantsAlpha ? 'image/png' : supportsWebp(canvas) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, mime === 'image/png' ? undefined : quality)
    );
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;
    const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
    const base = file.name.replace(/\.[a-z0-9]+$/i, '') || 'bild';
    return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    if (bitmap && 'close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

function supportsWebp(canvas: HTMLCanvasElement): boolean {
  try {
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

// Provtar ett rutnät av pixlar — räcker för att avgöra om PNG:n har genomskinlighet.
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(Math.max(w, h) / 64));
    for (let y = 0; y < h; y += step) {
      const row = ctx.getImageData(0, y, w, 1).data;
      for (let x = 3; x < row.length; x += 4 * step) {
        if (row[x] < 250) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
