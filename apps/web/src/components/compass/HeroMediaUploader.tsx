'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { validateWorkshopMediaFile, formatMbLimit, MAX_WORKSHOP_IMAGE_BYTES, MAX_WORKSHOP_VIDEO_BYTES } from '@platform/shared';
import type { WorkshopMediaKind } from '@platform/shared';

/**
 * Bild + video för landningssidan. Laddar upp direkt när en fil väljs (POST
 * till /api/inflode/modules/[id]/media — route handler, så stora videos ryms)
 * och visar förhandsvisning på plats. Ingen "Spara" behövs för media.
 */
export function HeroMediaUploader({
  moduleId,
  initialImageUrl,
  initialVideoUrl
}: {
  moduleId: string;
  initialImageUrl: string | null;
  initialVideoUrl: string | null;
}) {
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <MediaSlot
        moduleId={moduleId}
        kind="image"
        label="Bild"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        maxLabel={formatMbLimit(MAX_WORKSHOP_IMAGE_BYTES)}
        url={imageUrl}
        onChanged={(url) => {
          setImageUrl(url);
          router.refresh();
        }}
      />
      <MediaSlot
        moduleId={moduleId}
        kind="video"
        label="Video"
        accept="video/mp4,video/webm,video/ogg,video/quicktime"
        maxLabel={formatMbLimit(MAX_WORKSHOP_VIDEO_BYTES)}
        url={videoUrl}
        onChanged={(url) => {
          setVideoUrl(url);
          router.refresh();
        }}
      />
    </div>
  );
}

function MediaSlot({
  moduleId,
  kind,
  label,
  accept,
  maxLabel,
  url,
  onChanged
}: {
  moduleId: string;
  kind: WorkshopMediaKind;
  label: string;
  accept: string;
  maxLabel: string;
  url: string | null;
  onChanged: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const check = validateWorkshopMediaFile({ type: file.type, size: file.size }, kind);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('file', file);
      const res = await fetch(`/api/inflode/modules/${moduleId}/media`, {
        method: 'POST',
        body: fd
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error || 'Uppladdningen misslyckades.');
        return;
      }
      onChanged(data.url);
    } catch {
      setError('Uppladdningen misslyckades.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('remove', 'on');
      const res = await fetch(`/api/inflode/modules/${moduleId}/media`, {
        method: 'POST',
        body: fd
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || 'Kunde inte ta bort filen.');
        return;
      }
      onChanged(null);
    } catch {
      setError('Kunde inte ta bort filen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'var(--mx-paper-2)',
        border: '1px solid var(--mx-line-soft)',
        display: 'grid',
        gap: 8,
        alignContent: 'start'
      }}
    >
      <div className="mx-flex mx-items-c mx-gap-2">
        <span className="mx-fw-6 mx-t-13">{label}</span>
        <span className="mx-t-12 mx-muted">max {maxLabel}</span>
        <span className="mx-grow" />
        {url && (
          <button
            type="button"
            className="mx-btn mx-sm"
            onClick={remove}
            disabled={busy}
            style={{ color: '#4b2718' }}
          >
            <Icon name="trash" size={11} /> Ta bort
          </button>
        )}
      </div>

      {url ? (
        kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            style={{
              width: '100%',
              maxHeight: 160,
              objectFit: 'cover',
              borderRadius: 10,
              border: '1px solid var(--mx-line)'
            }}
          />
        ) : (
          <video
            src={url}
            controls
            preload="metadata"
            playsInline
            style={{
              width: '100%',
              maxHeight: 160,
              borderRadius: 10,
              border: '1px solid var(--mx-line)',
              background: 'var(--mx-paper)'
            }}
          />
        )
      ) : (
        <div className="mx-muted mx-t-12">Ingen {label.toLowerCase()} uppladdad.</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="mx-t-13"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {busy && <div className="mx-muted mx-t-12">Laddar upp…</div>}
      {error && (
        <div className="mx-t-12" style={{ color: '#4b2718' }}>
          {error}
        </div>
      )}
    </div>
  );
}
