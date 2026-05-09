'use client';

import { useTransition, useState } from 'react';
import { runToolAction } from '@/lib/actions/tools';
import { useRouter } from 'next/navigation';

interface RunToolFormProps {
  toolId: string;
  requiresStartup: boolean;
  startups: Array<{ id: string; name: string }>;
  defaultStartupId?: string;
}

export function RunToolForm({
  toolId,
  requiresStartup,
  startups,
  defaultStartupId
}: RunToolFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [startupId, setStartupId] = useState(defaultStartupId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runToolAction(toolId, startupId || undefined);
      if (result.error) {
        setError(result.error);
      } else if (result.runId) {
        router.push(`/toolbox/runs/${result.runId}`);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {requiresStartup && (
        <div>
          <label htmlFor="startup" className="block text-sm font-medium text-foreground-muted">
            Välj bolag *
          </label>
          <select
            id="startup"
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            required
            className="mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          >
            <option value="">-- Välj bolag --</option>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || (requiresStartup && !startupId)}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Kör…' : 'Kör verktyg'}
      </button>

      {isPending && (
        <p className="text-center text-xs text-foreground-muted">
          AI-svar kan ta upp till 30 sekunder…
        </p>
      )}
    </form>
  );
}
