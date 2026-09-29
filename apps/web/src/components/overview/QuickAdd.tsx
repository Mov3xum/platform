'use client';

import { useState, useTransition } from 'react';
import { createTaskAction } from '@/lib/actions/tasks';
import { Icon } from '@/components/proto/Icon';
import type { StartupOption } from '@/lib/overview/aggregate';

/**
 * Snabbtillägg med titel, valfritt förfallodatum och valfritt bolag — så att
 * nya kort får en plats i tidsindelningen direkt i stället för att hamna
 * under "Utan datum".
 */
export function QuickAdd({ startupOptions }: { startupOptions: StartupOption[] }) {
  const [value, setValue] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [startupId, setStartupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const description = value.trim();
    if (!description) return;
    startTransition(async () => {
      const res = await createTaskAction({
        description,
        dueAt: dueAt || undefined,
        startupId: startupId || undefined
      });
      if (res.ok) {
        setValue('');
        setDueAt('');
        setStartupId('');
        setError(null);
      } else {
        setError(res.error || 'Kunde inte skapa uppgift.');
      }
    });
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-default bg-surface px-3 py-2 transition focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-movexum-pastell-lila dark:focus-within:ring-movexum-morklila">
          <Icon name="plus" size={14} className="text-foreground-subtle" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Lägg till en uppgift…"
            maxLength={500}
            aria-label="Ny uppgift"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-subtle"
          />
        </label>
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          aria-label="Förfallodatum"
          title="Förfallodatum"
          className="rounded-xl border border-default bg-surface px-2.5 py-2 text-[12px] text-foreground outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
        {startupOptions.length > 0 && (
          <select
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            aria-label="Bolag"
            title="Bolag"
            className="max-w-[200px] rounded-xl border border-default bg-surface px-2.5 py-2 text-[12px] text-foreground outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          >
            <option value="">Inget bolag</option>
            {startupOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          Lägg till
        </button>
      </form>
      {error && <p className="mt-1.5 text-[11px] text-movexum-orange">{error}</p>}
    </div>
  );
}
