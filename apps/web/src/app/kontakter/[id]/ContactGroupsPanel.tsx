'use client';

import { actionErrorMessage } from '@/lib/action-error';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { sameIdSet } from '@platform/shared';
import { setContactGroupsAction } from '@/lib/actions/contact-groups';
import { Notice, btnPrimary } from '../ui';

/** Kontaktkortets grupper (§ 45.8): bocka i/ur och spara. */
export function ContactGroupsPanel({
  contactId,
  groups,
  selected,
  canEdit
}: {
  contactId: string;
  groups: Array<{ id: string; name: string }>;
  selected: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string[]>(selected);
  const [message, setMessage] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = !sameIdSet(value, selected);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        Inga grupper än.{' '}
        {canEdit && (
          <Link href="/kontakter/grupper" className="text-link hover:underline">
            Skapa en grupp
          </Link>
        )}
      </p>
    );
  }

  if (!canEdit) {
    const names = groups.filter((g) => selected.includes(g.id)).map((g) => g.name);
    return <p className="text-sm text-foreground-muted">{names.length ? names.join(', ') : 'Inte med i någon grupp.'}</p>;
  }

  const save = () => {
    setMessage(null);
    start(async () => {
      let res: Awaited<ReturnType<typeof setContactGroupsAction>>;
      try {
        res = await setContactGroupsAction(contactId, value);
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Grupperna kunde inte sparas. Ladda om sidan och försök igen.') };
      }
      setMessage(res.error ? { kind: 'error', text: res.error } : { kind: 'notice', text: res.notice ?? 'Sparat.' });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const on = value.includes(g.id);
          return (
            <label
              key={g.id}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                on ? 'border-strong bg-canvas-muted text-foreground' : 'border-default text-foreground-muted hover:bg-canvas-subtle'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => setValue((prev) => (on ? prev.filter((id) => id !== g.id) : [...prev, g.id]))}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
              {g.name}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} onClick={save} disabled={pending || !dirty}>
          {pending ? 'Sparar…' : 'Spara grupper'}
        </button>
        <Link href="/kontakter/grupper" className="text-xs text-link hover:underline">
          Hantera grupper
        </Link>
      </div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
    </div>
  );
}
