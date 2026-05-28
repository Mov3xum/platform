'use client';

import { useState, useTransition } from 'react';
import { assignWorkshopToStartupAction } from '@/lib/actions/workshops';

interface WorkshopAssignFormProps {
  workshopId: string;
  startups: Array<{ id: string; name: string }>;
}

export function WorkshopAssignForm({ workshopId, startups }: WorkshopAssignFormProps) {
  const [startupId, setStartupId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3 rounded-2xl border border-default bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        startTransition(async () => {
          const result = await assignWorkshopToStartupAction(workshopId, startupId, dueDate || undefined);
          if (result.error) {
            setError(result.error);
            return;
          }
          setMessage('Workshop tilldelad.');
          setStartupId('');
          setDueDate('');
        });
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">Tilldela bolag</h3>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          Bolaget ser workshopen i sin utbildningsöversikt.
        </p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">Bolag</span>
        <select
          value={startupId}
          onChange={(e) => setStartupId(e.target.value)}
          required
          className="w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        >
          <option value="">-- Välj bolag --</option>
          {startups.map((startup) => (
            <option key={startup.id} value={startup.id}>
              {startup.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-foreground-muted">
          Förfallodatum (valfritt)
        </span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </label>
      <button
        type="submit"
        disabled={isPending || !startupId}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Tilldelar…' : 'Tilldela workshop'}
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
