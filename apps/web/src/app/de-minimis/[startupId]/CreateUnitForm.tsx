'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUnitAction } from '@/lib/actions/de-minimis';

export function CreateUnitForm({
  startupId,
  defaultName
}: {
  startupId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [namn, setNamn] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createUnitAction(startupId, namn);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-semibold text-foreground-muted" htmlFor="new-unit-namn">
          Namn på enhet (ett enda företag)
        </label>
        <input
          id="new-unit-namn"
          value={namn}
          onChange={(e) => setNamn(e.target.value)}
          maxLength={200}
          required
          className="w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
      >
        {isPending ? 'Skapar…' : 'Skapa enhet'}
      </button>
      {error ? <p className="w-full text-sm text-movexum-morkorange dark:text-movexum-orange">{error}</p> : null}
    </form>
  );
}
