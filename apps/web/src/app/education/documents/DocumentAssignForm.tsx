'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { assignDocumentToStartupAction } from '@/lib/actions/education-documents';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

interface DocumentAssignFormProps {
  documentId: string;
  startups: Array<{ id: string; name: string }>;
}

export function DocumentAssignForm({ documentId, startups }: DocumentAssignFormProps) {
  const router = useRouter();
  const [startupId, setStartupId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await assignDocumentToStartupAction(
        documentId,
        startupId,
        instructions || undefined,
        dueDate || undefined
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage('Dokumentet tilldelades bolaget.');
      setStartupId('');
      setInstructions('');
      setDueDate('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2.5 rounded-xl border border-default bg-canvas-subtle/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
        Tilldela bolag
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Bolag</span>
        <select
          value={startupId}
          onChange={(e) => setStartupId(e.target.value)}
          required
          className={inputClass}
        >
          <option value="">-- Välj bolag --</option>
          {startups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">
          Instruktioner (valfritt)
        </span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={2000}
          rows={2}
          className={inputClass}
          placeholder="Vad ska bolaget göra med dokumentet?"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">
          Deadline (valfritt)
        </span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={isPending || !startupId}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Tilldelar…' : 'Tilldela'}
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
