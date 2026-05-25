'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addToolKnowledgeAction,
  deleteToolKnowledgeAction
} from '@/lib/actions/tool-knowledge';

export interface KnowledgeItem {
  id: string;
  title?: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  char_count?: number;
  redacted?: boolean;
}

interface KnowledgeManagerProps {
  toolId: string;
  items: KnowledgeItem[];
}

const ACCEPT = '.pdf,.txt,.md,.csv,.xlsx,application/pdf,text/plain,text/markdown,text/csv';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeManager({ toolId, items }: KnowledgeManagerProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const inputClass =
    'w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const handleUpload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set('toolId', toolId);
    startTransition(async () => {
      const result = await addToolKnowledgeAction(null as never, formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        router.refresh();
      }
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await deleteToolKnowledgeAction(id);
      setBusyId(null);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <section className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <h2 className="text-base font-semibold text-foreground">Kunskapsbas</h2>
      <p className="mt-1 text-sm text-foreground-muted">
        Referensmaterial som agenten använder vid varje körning. Texten extraheras och
        läggs in i prompten under &quot;referensmaterial&quot; (data, inte instruktioner).
      </p>

      <div className="mt-3 rounded-2xl border border-movexum-gul/40 bg-movexum-pastell-gul px-4 py-3 dark:border-movexum-morkgul/50 dark:bg-movexum-morkgul/20">
        <p className="text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">
          ⚠️ Ladda inte upp personuppgifter (namn, e-post, personnummer). Personnummer
          maskas automatiskt, men annan PII gör det inte. Tillåtet: PDF, text, Markdown,
          CSV, Excel — max 10 MB/fil.
        </p>
      </div>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-default px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {it.title || it.filename}
                </p>
                <p className="text-xs text-foreground-subtle">
                  {it.filename} · {formatBytes(it.size_bytes)}
                  {typeof it.char_count === 'number' ? ` · ${it.char_count} tecken` : ''}
                  {it.redacted ? ' · personnummer maskat' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(it.id)}
                disabled={isPending && busyId === it.id}
                className="shrink-0 rounded-full border border-default px-3 py-1.5 text-xs font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-50 dark:text-movexum-pastell-orange dark:hover:bg-movexum-morkorange/30"
              >
                {isPending && busyId === it.id ? 'Tar bort…' : 'Ta bort'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-foreground-subtle">
          Inga filer i kunskapsbasen ännu.
        </p>
      )}

      <form ref={formRef} onSubmit={handleUpload} className="mt-5 space-y-3">
        <div>
          <label htmlFor="kb_title" className="block text-sm font-medium text-foreground-muted">
            Etikett (valfri)
          </label>
          <input
            id="kb_title"
            name="title"
            type="text"
            maxLength={200}
            placeholder="t.ex. Bedömningskriterier IRL"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="kb_file" className="block text-sm font-medium text-foreground-muted">
            Fil *
          </label>
          <input
            id="kb_file"
            name="file"
            type="file"
            required
            accept={ACCEPT}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        {error && (
          <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isPending && !busyId}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          {isPending && !busyId ? 'Laddar upp…' : 'Lägg till i kunskapsbas'}
        </button>
      </form>
    </section>
  );
}
