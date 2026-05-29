'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  validateEducationDocumentFile,
  formatDocumentMbLimit,
  MAX_EDUCATION_DOCUMENT_BYTES
} from '@platform/shared';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function DocumentUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en fil.');
      return;
    }
    const validation = validateEducationDocumentFile({
      type: file.type,
      size: file.size,
      name: file.name
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!title.trim()) {
      setError('Ange en titel.');
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title.trim());
    if (description.trim()) fd.append('description', description.trim());

    startTransition(async () => {
      try {
        const res = await fetch('/api/education/documents', { method: 'POST', body: fd });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error || 'Uppladdningen misslyckades.');
          return;
        }
        setMessage('Dokumentet laddades upp.');
        setTitle('');
        setDescription('');
        setFileName('');
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch {
        setError('Nätverksfel vid uppladdning.');
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-default bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Ladda upp dokument</h3>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          PDF, Excel, PowerPoint eller Word (max {formatDocumentMbLimit(MAX_EDUCATION_DOCUMENT_BYTES)}).
          Ladda inte upp personuppgifter — filer nås via direktlänk.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Titel</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          className={inputClass}
          placeholder="t.ex. Mall för affärsplan"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">
          Beskrivning (valfritt)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Fil</span>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xls,.xlsx,.ppt,.pptx,.doc,.docx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
          className="block w-full text-sm text-foreground-muted file:mr-3 file:rounded-full file:border-0 file:bg-canvas-muted file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-canvas-subtle"
        />
        {fileName ? (
          <span className="mt-1 block truncate font-mono text-[11px] text-foreground-subtle">
            {fileName}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Laddar upp…' : 'Ladda upp'}
      </button>

      {error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
          {message}
        </p>
      ) : null}
    </form>
  );
}
