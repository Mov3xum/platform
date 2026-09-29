'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { deleteProcurementDocumentAction } from '@/lib/actions/procurements';
import { AiBanner, Notice, btnGhost } from '../ui';

export interface ProcurementDocView {
  id: string;
  title?: string | null;
  filename: string;
  url: string | null;
  sizeBytes?: number | null;
  analyzed: boolean;
  created?: string;
}

function formatSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Underlag kopplade till upphandlingen — ladda upp fler (t.ex. avtalet efter tilldelning) eller ta bort. */
export function DocumentsPanel({
  procurementId,
  documents,
  canManage
}: {
  procurementId: string;
  documents: ProcurementDocView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en fil först.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('procurement_id', procurementId);
      // Bara arkivering här — utläsningen görs vid skapandet (/upphandlingar/ny).
      fd.append('analyze', 'false');
      const res = await fetch('/api/procurements/documents', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'Uppladdningen misslyckades.');
        return;
      }
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      {documents.length === 0 ? (
        <p className="text-sm text-foreground-subtle">Inget underlag uppladdat.</p>
      ) : (
        <ul className="divide-y divide-default">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <Icon name="doc" size={14} />
              <div className="min-w-0 flex-1">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
                    {d.title || d.filename}
                  </a>
                ) : (
                  <span className="font-medium text-foreground">{d.title || d.filename}</span>
                )}
                <div className="text-xs text-foreground-subtle">
                  {[formatSize(d.sizeBytes), d.analyzed ? 'AI-utläst' : null, d.created?.slice(0, 10)].filter(Boolean).join(' · ')}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  disabled={pending}
                  className={btnGhost}
                  onClick={() => {
                    if (!confirm('Ta bort dokumentet?')) return;
                    startTransition(async () => {
                      const r = await deleteProcurementDocumentAction(d.id, procurementId);
                      if (r.error) setError(r.error);
                      else router.refresh();
                    });
                  }}
                  aria-label="Ta bort"
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md" className="text-sm text-foreground-muted" />
          <button type="button" onClick={upload} disabled={uploading} className={btnGhost}>
            <Icon name="upload" size={12} /> {uploading ? 'Laddar upp…' : 'Ladda upp'}
          </button>
        </div>
      )}
      <AiBanner />
    </div>
  );
}
