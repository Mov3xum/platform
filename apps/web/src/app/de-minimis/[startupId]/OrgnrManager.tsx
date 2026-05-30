'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addUnitOrgnrAction, removeUnitOrgnrAction } from '@/lib/actions/de-minimis';
import { Icon } from '@/components/proto/Icon';

export interface OrgnrRow {
  id: string;
  organisationsnummer: string;
}

export function OrgnrManager({
  unitId,
  rows,
  canManage
}: {
  unitId: string;
  rows: OrgnrRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addUnitOrgnrAction(unitId, value);
      if (res.error) {
        setError(res.error);
        return;
      }
      setValue('');
      router.refresh();
    });
  };

  const onRemove = (id: string) => {
    startTransition(async () => {
      const res = await removeUnitOrgnrAction(id);
      if (res.error) {
        window.alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-xs text-foreground-subtle">Inga organisationsnummer kopplade ännu.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-canvas-muted px-2.5 py-1 font-mono text-xs text-foreground"
            >
              {r.organisationsnummer}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => onRemove(r.id)}
                  disabled={isPending}
                  className="text-foreground-subtle transition hover:text-movexum-morkorange disabled:opacity-60"
                  aria-label="Ta bort organisationsnummer"
                >
                  <Icon name="x" size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={32}
            placeholder="556677-8899"
            className="rounded-lg border border-default bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-strong"
          />
          <button
            type="submit"
            disabled={isPending || !value.trim()}
            className="inline-flex items-center gap-1 rounded-full border border-default px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
          >
            <Icon name="plus" size={12} /> Lägg till org.nr
          </button>
          {error ? (
            <p className="w-full text-xs text-movexum-morkorange dark:text-movexum-orange">{error}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
