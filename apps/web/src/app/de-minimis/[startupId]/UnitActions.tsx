'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteUnitAction, renameUnitAction } from '@/lib/actions/de-minimis';
import { Icon } from '@/components/proto/Icon';

export function UnitActions({
  unitId,
  namn,
  canManage
}: {
  unitId: string;
  namn: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(namn);
  const [isPending, startTransition] = useTransition();

  if (!canManage) return null;

  const onRename = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await renameUnitAction(unitId, value);
      if (res.error) {
        window.alert(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const onDelete = () => {
    if (
      !window.confirm(
        'Ta bort enheten och ALLA dess stödposter och organisationsnummer? Detta går inte att ångra.'
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteUnitAction(unitId);
      if (res.error) {
        window.alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <form onSubmit={onRename} className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          className="rounded-lg border border-default bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-strong"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-60"
        >
          Spara
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(namn);
            setEditing(false);
          }}
          className="text-xs font-medium text-foreground-muted hover:underline"
        >
          Avbryt
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-full border border-default px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
      >
        <Icon name="pencil" size={12} /> Byt namn
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-full border border-default px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
      >
        <Icon name="trash" size={12} /> Ta bort enhet
      </button>
    </div>
  );
}
