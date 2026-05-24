'use client';

import { useState, useTransition } from 'react';
import { createTaskAction } from '@/lib/actions/tasks';
import { Icon } from '@/components/proto/Icon';

export function QuickAdd() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const description = value.trim();
    if (!description) return;
    startTransition(async () => {
      const res = await createTaskAction({ description });
      if (res.ok) {
        setValue('');
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
        className="flex items-center gap-2"
      >
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-default bg-surface px-3 py-2 transition focus-within:border-brand/50">
          <Icon name="plus" size={14} className="text-foreground-subtle" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Lägg till en uppgift…"
            maxLength={500}
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-subtle"
          />
        </label>
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
