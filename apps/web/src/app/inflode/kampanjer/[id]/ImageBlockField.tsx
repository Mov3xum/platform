'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/proto';
import { resizeImageFile } from '@/lib/image-resize';
import { EMAIL_IMAGE_MAX_BYTES, EMAIL_IMAGE_MAX_EDGE, isEmailMediaPath, validateEmailImageFile, type EmailBlock } from '@platform/shared';

type ImageBlock = Extract<EmailBlock, { type: 'image' }>;

const UPLOAD_ENDPOINT = '/api/inflode/kampanjer/media';
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Bildblocket i kampanjeditorn (CLAUDE.md § 55.9): ladda upp en bild (knapp,
 * dra-och-släpp eller klistra in) eller ange en adress. Bilden skalas ned i
 * webbläsaren (längsta sida 1200 px — 520 px i mejlet × 2) och sparas som
 * PB-fil via route-handlern; blocket får en app-relativ sökväg som renderaren
 * absolutiserar vid utskick. Ett tomt block (mallens valfria bildplats)
 * visas inte i mejlet och stoppar inte utskicket.
 */
export function ImageBlockField({ block, onChange }: { block: ImageBlock; onChange: (b: EmailBlock) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [useUrl, setUseUrl] = useState(() => Boolean(block.url) && !isEmailMediaPath(block.url));

  async function upload(original: File) {
    setError(null);
    const check = validateEmailImageFile({ type: original.type, size: original.size, name: original.name });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      // 1200 px räcker för 520 px bredd på skarpa skärmar — och håller mejlet lätt.
      const file = await resizeImageFile(original, { maxEdge: EMAIL_IMAGE_MAX_EDGE, skipBelowBytes: 250 * 1024 });
      if (file.size > EMAIL_IMAGE_MAX_BYTES) {
        setError('Bilden är för stor även efter nedskalning — välj en mindre bild.');
        return;
      }
      const fd = new FormData();
      fd.set('file', file);
      const dims = await readDimensions(file);
      if (dims) {
        fd.set('width', String(dims.width));
        fd.set('height', String(dims.height));
      }
      const res = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error || describeHttpFailure(res.status));
        return;
      }
      setUseUrl(false);
      onChange({ ...block, url: data.url });
    } catch {
      setError('Uppladdningen misslyckades — kontrollera nätverket och försök igen.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function pickFile(list: FileList | DataTransferItemList | null | undefined) {
    if (!list) return;
    for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
      const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null;
      if (file && file.type.startsWith('image/')) {
        void upload(file);
        return;
      }
    }
    setError('Släpp eller klistra in en bild (PNG, JPG, WEBP, GIF).');
  }

  const input = 'mx-input';
  const hasImage = Boolean(block.url);

  return (
    <div className="grid gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files);
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            pickFile(e.clipboardData.files);
          }
        }}
        tabIndex={0}
        style={{
          borderRadius: 10,
          border: `1px ${dragging ? 'solid var(--color-brand)' : 'dashed var(--mx-line)'}`,
          background: dragging ? 'var(--color-canvas-muted)' : 'var(--mx-paper-2)',
          padding: hasImage ? 8 : 16,
          display: 'grid',
          gap: 8,
          justifyItems: 'center'
        }}
        aria-label="Släpp en bild här"
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.url} alt={block.alt || ''} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, display: 'block' }} />
        ) : (
          <span className="mx-flex mx-items-c mx-gap-2 mx-muted mx-t-xs">
            <Icon name="image" size={16} /> Ingen bild än — dra hit, klistra in eller välj en fil. Blocket visas inte förrän en bild finns.
          </span>
        )}
        <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={12} /> {busy ? 'Laddar upp…' : hasImage ? 'Byt bild' : 'Ladda upp bild'}
          </button>
          {hasImage && (
            <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => onChange({ ...block, url: '' })}>
              <Icon name="trash" size={12} /> Ta bort
            </button>
          )}
          <button type="button" className="mx-btn mx-sm mx-ghost" onClick={() => setUseUrl((v) => !v)}>
            {useUrl ? 'Dölj adressfält' : 'Ange adress i stället'}
          </button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files)} />
      </div>
      {useUrl && (
        <input
          className={input}
          value={isEmailMediaPath(block.url) ? '' : block.url}
          maxLength={2000}
          placeholder="Bildens adress (https://…) — bilden måste ligga publikt på webben"
          onChange={(e) => onChange({ ...block, url: e.target.value })}
        />
      )}
      {error && (
        <span className="mx-t-xs" style={{ color: 'var(--movexum-morkorange)' }}>
          {error}
        </span>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} value={block.alt} maxLength={200} placeholder="Alternativtext (vad bilden visar)" onChange={(e) => onChange({ ...block, alt: e.target.value })} />
        <input className={input} value={block.href} maxLength={2000} placeholder="Länk vid klick (valfritt)" onChange={(e) => onChange({ ...block, href: e.target.value })} />
      </div>
      <span className="mx-t-xs mx-muted">
        PNG, JPG, WEBP eller GIF, max {Math.round(EMAIL_IMAGE_MAX_BYTES / (1024 * 1024))} MB. Håll mejlet textburet — en stor bild och lite text
        är en klassisk skräppostsignal. Ladda inte upp bilder med personuppgifter.
      </span>
    </div>
  );
}

async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out.width > 0 && out.height > 0 ? out : null;
  } catch {
    return null;
  }
}

function describeHttpFailure(status: number): string {
  if (status === 413) return 'Bilden är för stor för servern/proxyn (413). Välj en mindre bild.';
  if (status === 401) return 'Du är utloggad — logga in igen och försök på nytt.';
  if (status === 403) return 'Du saknar behörighet att ladda upp bilder.';
  if (status === 429) return 'För många uppladdningar — vänta en stund.';
  if (status >= 500) return `Servern svarade ${status} — försök igen om en stund.`;
  return `Uppladdningen misslyckades (HTTP ${status}).`;
}
