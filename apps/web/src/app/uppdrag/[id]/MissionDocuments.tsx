'use client';

// CLAUDE.md § 29 — "Dokumentation" på uppdraget (ersätter artefakter).
// Ladda upp riktiga filer via route-handlern (slipper bodySizeLimit) och
// lista/radera dem. Staff-only redigering; alla med åtkomst ser listan.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/proto';
import { deleteMissionDocumentAction } from '@/lib/actions/mission-documents';

export interface MissionDocView {
  id: string;
  title?: string;
  filename: string;
  url: string;
  sizeBytes?: number;
  created?: string;
}

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MissionDocuments({
  missionId,
  documents,
  canManage
}: {
  missionId: string;
  documents: MissionDocView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
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
      const title = titleRef.current?.value.trim();
      if (title) fd.append('title', title);
      const res = await fetch(`/api/missions/${missionId}/documents`, {
        method: 'POST',
        body: fd
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Kunde inte ladda upp filen.');
        return;
      }
      if (fileRef.current) fileRef.current.value = '';
      if (titleRef.current) titleRef.current.value = '';
      router.refresh();
    } catch {
      setError('Något gick fel vid uppladdningen.');
    } finally {
      setUploading(false);
    }
  }

  function remove(docId: string) {
    startTransition(async () => {
      const res = await deleteMissionDocumentAction(docId, missionId);
      if (!res.ok) setError(res.error || 'Kunde inte radera dokumentet.');
      else router.refresh();
    });
  }

  return (
    <Card style={{ padding: 16 }}>
      <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
        <Icon name="doc" size={14} />
        <div className="mx-fw-6 mx-t-14">Dokumentation ({documents.length})</div>
      </div>

      {error && (
        <div
          className="mx-card mx-mb-2"
          style={{ padding: 10, background: 'var(--mx-st-danger-bg, #f1e5df)', color: '#4b2718' }}
        >
          <div className="mx-t-12 mx-fw-6">{error}</div>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="mx-muted mx-t-13 mx-mb-3">Ingen dokumentation uppladdad ännu.</div>
      ) : (
        <div className="mx-flex mx-col mx-gap-2 mx-mb-3">
          {documents.map((d) => {
            const meta = [formatSize(d.sizeBytes), d.created ? new Date(d.created).toLocaleDateString('sv-SE') : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={d.id}
                className="mx-flex mx-items-c mx-gap-3"
                style={{ padding: '10px 12px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
              >
                <Icon name="doc" size={16} className="mx-muted" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mx-t-13 mx-fw-6 mx-truncate">{d.title || d.filename}</div>
                  <div className="mx-t-xs mx-muted mx-mono">{meta || d.filename}</div>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-btn mx-sm mx-ghost"
                  aria-label="Öppna"
                >
                  <Icon name="download" size={12} />
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    disabled={pending}
                    className="mx-btn mx-sm mx-ghost"
                    aria-label="Radera"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <div className="mx-flex mx-col mx-gap-2">
          <input
            ref={titleRef}
            maxLength={200}
            placeholder="Titel (valfritt)"
            className="mx-input"
            style={{
              border: '1px solid var(--mx-line)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--mx-paper)'
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xls,.xlsx,.ppt,.pptx,.doc,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
            className="mx-t-12"
          />
          <button
            type="button"
            className="mx-btn mx-sm mx-primary"
            onClick={upload}
            disabled={uploading}
          >
            <Icon name="upload" size={12} />
            {uploading ? 'Laddar upp…' : 'Ladda upp dokumentation'}
          </button>
          <div className="mx-t-12 mx-muted">
            PDF, Office, text/CSV eller bild. Max 25 MB. Ladda inte upp
            personuppgifter i onödan.
          </div>
        </div>
      )}
    </Card>
  );
}
