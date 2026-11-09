'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { deleteDocumentAction } from '@/lib/actions/support-checks';
import { Notice, btnGhost } from '../ui';

export interface DocView {
  id: string;
  title: string | null;
  filename: string;
  kind: string;
  url: string;
  sizeBytes: number | null;
  created: string;
  canDelete: boolean;
}

const KIND_LABEL: Record<string, string> = { attachment: 'Bilaga', final_report: 'Slutrapport', receipt: 'Kvitto', signed_application: 'Signerad ansökan', other: 'Övrigt' };

function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Bilagor (aktivitetsplan, offerter, kvitton, slutrapport) — riktiga PB-filer bakom den scopade proxyn. */
export function DocumentsPanel({ applicationId, documents, canUpload, allowReportKinds }: { applicationId: string; documents: DocView[]; canUpload: boolean; allowReportKinds: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(allowReportKinds ? 'final_report' : 'attachment');
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
      fd.append('application_id', applicationId);
      fd.append('kind', kind);
      const res = await fetch('/api/checkar/documents', { method: 'POST', body: fd });
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
        <p className="text-sm text-foreground-subtle">Inga bilagor.</p>
      ) : (
        <ul className="divide-y divide-default">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <Icon name="doc" size={14} />
              <div className="min-w-0 flex-1">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
                  {d.title || d.filename}
                </a>
                <div className="text-xs text-foreground-subtle">{[KIND_LABEL[d.kind] ?? d.kind, formatSize(d.sizeBytes), d.created].filter(Boolean).join(' · ')}</div>
              </div>
              {d.canDelete && (
                <button
                  type="button"
                  disabled={pending}
                  className={btnGhost}
                  aria-label="Ta bort"
                  onClick={() => {
                    if (!confirm('Ta bort bilagan?')) return;
                    startTransition(async () => {
                      const r = await deleteDocumentAction(d.id);
                      if (r.error) setError(r.error);
                      router.refresh();
                    });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-xl border border-default bg-surface px-2 py-1.5 text-sm text-foreground" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="attachment">Bilaga</option>
            {allowReportKinds && <option value="final_report">Slutrapport</option>}
            {allowReportKinds && <option value="receipt">Kvitto</option>}
            <option value="other">Övrigt</option>
          </select>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,.png,.jpg,.jpeg" className="text-sm text-foreground-muted" />
          <button type="button" onClick={upload} disabled={uploading} className={btnGhost}>
            <Icon name="upload" size={12} /> {uploading ? 'Laddar upp…' : 'Ladda upp'}
          </button>
        </div>
      )}
      <p className="text-xs text-foreground-subtle">Ladda inte upp personuppgifter i onödan — bilagorna är underlag för Movexums bedömning.</p>
    </div>
  );
}
