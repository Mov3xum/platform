'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import { FILE_TOPICS, FILE_TOPIC_LABELS } from '@platform/shared';
import {
  deleteOrgKnowledgeAction,
  reindexOrgKnowledgeAction,
  type OrgKnowledgeListItem
} from '@/lib/actions/org-knowledge';

const ACCEPT =
  '.pdf,.txt,.md,.csv,.xlsx,.docx,.pptx,application/pdf,text/plain,text/markdown,text/csv,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeManager({
  initialFiles
}: {
  initialFiles: OrgKnowledgeListItem[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en fil att ladda upp.');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    if (title.trim()) fd.append('title', title.trim());
    if (topic) fd.append('topic', topic);

    setUploading(true);
    try {
      const res = await fetch('/api/knowledge', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        indexed?: boolean;
        chunkCount?: number;
      };
      if (!res.ok) {
        setError(data.error || 'Kunde inte ladda upp filen.');
        return;
      }
      setNotice(
        data.indexed
          ? `Uppladdad och indexerad (${data.chunkCount ?? 0} stycken). Chatten kan nu svara på frågor om den.`
          : 'Uppladdad. Indexeringen gick inte fullt ut — filen är sökbar via nyckelord, försök "Indexera om".'
      );
      setTitle('');
      setTopic('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch {
      setError('Kunde inte ladda upp filen.');
    } finally {
      setUploading(false);
    }
  }

  function handleDelete(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteOrgKnowledgeAction(id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleReindex(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await reindexOrgKnowledgeAction(id);
      if (res.error) setError(res.error);
      else {
        setNotice('Filen indexerades om.');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-1 font-heading text-lg font-semibold text-foreground">Lägg till material</h2>
        <p className="mb-4 text-xs text-foreground-subtle">
          PDF, Word, PowerPoint, Excel, text, Markdown eller CSV (max 25 MB).
          Ladda <strong>inte</strong> upp personuppgifter — innehållet blir sökbart för AI:n.
          Personnummer saneras automatiskt.
        </p>

        <form onSubmit={handleUpload} className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-foreground hover:file:bg-brand-hover"
          />
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titel (valfri)"
              maxLength={300}
              className="min-w-[12rem] flex-1 rounded-lg border border-default bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle"
            />
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="rounded-lg border border-default bg-canvas px-3 py-2 text-sm text-foreground"
            >
              <option value="">Ämne (valfritt)</option>
              {FILE_TOPICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
            >
              <Icon name="upload" size={16} />
              {uploading ? 'Laddar upp…' : 'Ladda upp'}
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron">
            <Icon name="check" size={16} />
            <span>{notice}</span>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Material ({initialFiles.length})
        </h2>
        {initialFiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
            Inget material än. Ladda upp det första dokumentet ovan.
          </div>
        ) : (
          <ul className="space-y-3">
            {initialFiles.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                    <Icon name="doc" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                    <p className="text-xs text-foreground-subtle">
                      {[
                        f.topic ? FILE_TOPIC_LABELS[f.topic as keyof typeof FILE_TOPIC_LABELS] : null,
                        formatBytes(f.size_bytes),
                        f.indexed
                          ? `Indexerad · ${f.chunk_count ?? 0} stycken`
                          : 'Ej indexerad',
                        f.redacted ? 'Personnummer sanerat' : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!f.indexed ? (
                    <button
                      type="button"
                      onClick={() => handleReindex(f.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-sm text-foreground-muted hover:bg-canvas-subtle disabled:opacity-60"
                    >
                      <Icon name="rotate-ccw" size={14} /> Indexera om
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(f.id)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-sm text-movexum-morkorange hover:bg-movexum-pastell-orange disabled:opacity-60"
                  >
                    <Icon name="trash" size={14} /> Radera
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-foreground-subtle">
          AI-verktyg drivs av Mistral (Frankrike, EU-suveränt). Genererade svar — verifiera innan delning.
        </p>
      </section>
    </div>
  );
}
