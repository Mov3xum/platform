'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { formatOrgPostMediaSize, type OrgPostMedia } from '@platform/shared';

/**
 * Media på ett inlägg (CLAUDE.md § 37.6): bildgalleri med lightbox, film
 * inline och dokument som chips. Delas av inläggsvyn OCH redigerarens
 * förhandsgranskning så det ser likadant ut före och efter publicering.
 * URL:erna är redan validerade som org_post_media-filer (aldrig fria länkar).
 */

const FILE_ICON: Record<string, string> = {
  'application/pdf': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file-text',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'image',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'graph'
};

const FILE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel'
};

export function fileTypeLabel(mime: string): string {
  return FILE_LABEL[mime] ?? 'Fil';
}

function Lightbox({
  images,
  index,
  onClose,
  onStep
}: {
  images: OrgPostMedia[];
  index: number;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onStep(1);
      if (e.key === 'ArrowLeft') onStep(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onStep]);

  const img = images[index];
  if (!img) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img.name || 'Bild'}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-movexum-svart/85 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Stäng"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-movexum-vit/10 text-movexum-vit transition hover:bg-movexum-vit/20"
      >
        <Icon name="close" size={18} />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStep(-1);
            }}
            aria-label="Föregående"
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-movexum-vit/10 text-movexum-vit transition hover:bg-movexum-vit/20"
          >
            <Icon name="back" size={18} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStep(1);
            }}
            aria-label="Nästa"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-movexum-vit/10 text-movexum-vit transition hover:bg-movexum-vit/20"
          >
            <Icon name="arrow" size={18} />
          </button>
        </>
      )}
      <figure className="flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={img.name || ''}
          className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain shadow-2xl shadow-movexum-svart/50"
        />
        <figcaption className="text-[12.5px] text-movexum-vit/80">
          {img.name}
          {images.length > 1 ? ` · ${index + 1} / ${images.length}` : ''}
        </figcaption>
      </figure>
    </div>
  );
}

interface Props {
  media: OrgPostMedia[];
  /** Kompakt tumnagelrad (hopfällda notiser). */
  compact?: boolean;
  className?: string;
}

export function PostMedia({ media, compact = false, className = '' }: Props) {
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  const files = media.filter((m) => m.kind === 'file');
  const [open, setOpen] = useState<number | null>(null);

  const step = useCallback(
    (dir: 1 | -1) => setOpen((i) => (i === null ? null : (i + dir + images.length) % images.length)),
    [images.length]
  );
  const close = useCallback(() => setOpen(null), []);

  if (media.length === 0) return null;

  const imgButton = (m: OrgPostMedia, i: number, cls: string, extra?: number) => (
    <button
      key={m.id}
      type="button"
      onClick={() => setOpen(i)}
      className={`group/img relative overflow-hidden rounded-xl bg-canvas-muted ${cls}`}
      aria-label={`Visa ${m.name || 'bild'} i full storlek`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={m.url}
        alt={m.name || ''}
        loading="lazy"
        width={m.width}
        height={m.height}
        className="h-full w-full object-cover transition duration-300 group-hover/img:scale-[1.02]"
      />
      {extra ? (
        <span className="absolute inset-0 flex items-center justify-center bg-movexum-svart/55 font-heading text-[22px] font-semibold text-movexum-vit">
          +{extra}
        </span>
      ) : null}
    </button>
  );

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {images.slice(0, 4).map((m, i) => imgButton(m, i, 'h-16 w-16', i === 3 && images.length > 4 ? images.length - 4 : undefined))}
        {videos.slice(0, 1).map((m) => (
          <span key={m.id} className="inline-flex h-16 items-center gap-1.5 rounded-xl bg-canvas-muted px-3 text-[12px] text-foreground-muted">
            <Icon name="video" size={14} /> Film
          </span>
        ))}
        {files.length > 0 && (
          <span className="inline-flex h-16 items-center gap-1.5 rounded-xl bg-canvas-muted px-3 text-[12px] text-foreground-muted">
            <Icon name="paperclip" size={13} /> {files.length === 1 ? fileTypeLabel(files[0].mime) : `${files.length} filer`}
          </span>
        )}
        {open !== null && <Lightbox images={images} index={open} onClose={close} onStep={step} />}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {images.length === 1 && (
        <div className="max-w-[720px]">
          {imgButton(images[0], 0, 'block w-full max-h-[520px]')}
        </div>
      )}
      {images.length === 2 && (
        <div className="grid max-w-[720px] grid-cols-2 gap-2">
          {images.map((m, i) => imgButton(m, i, 'aspect-[4/3] w-full'))}
        </div>
      )}
      {images.length === 3 && (
        <div className="grid max-w-[720px] grid-cols-3 grid-rows-2 gap-2">
          {imgButton(images[0], 0, 'col-span-2 row-span-2 aspect-[4/3] w-full h-full')}
          {imgButton(images[1], 1, 'aspect-[4/3] w-full h-full')}
          {imgButton(images[2], 2, 'aspect-[4/3] w-full h-full')}
        </div>
      )}
      {images.length >= 4 && (
        <div className="grid max-w-[720px] grid-cols-2 gap-2">
          {images.slice(0, 4).map((m, i) => imgButton(m, i, 'aspect-[4/3] w-full', i === 3 && images.length > 4 ? images.length - 4 : undefined))}
        </div>
      )}
      {videos.map((m) => (
        <div key={m.id} className="max-w-[720px] overflow-hidden rounded-xl bg-movexum-svart">
          <video src={m.url} controls preload="metadata" playsInline className="max-h-[520px] w-full" />
        </div>
      ))}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((m) => (
            <li key={m.id}>
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group/file inline-flex max-w-full items-center gap-2.5 rounded-xl border border-default bg-surface py-2 pl-2.5 pr-3 text-[12.5px] text-foreground transition hover:border-strong hover:bg-canvas-subtle"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-brand">
                  <Icon name={FILE_ICON[m.mime] ?? 'doc'} size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name || 'Dokument'}</span>
                  <span className="block text-[11px] text-foreground-subtle">
                    {fileTypeLabel(m.mime)}
                    {m.size_bytes ? ` · ${formatOrgPostMediaSize(m.size_bytes)}` : ''}
                  </span>
                </span>
                <Icon name="download" size={13} className="ml-1 shrink-0 text-foreground-subtle transition group-hover/file:text-brand" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <Lightbox images={images} index={open} onClose={close} onStep={step} />}
    </div>
  );
}
