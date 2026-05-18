'use client';

import { useState, useTransition } from 'react';

interface Props {
  action: (formData: FormData) => Promise<void>;
  hiddenField: { name: string; value: string };
  label?: string;
  confirmingLabel?: string;
  confirmedLabel?: string;
  cancelLabel?: string;
  description?: string;
  variant?: 'default' | 'subtle' | 'ghost';
  fullWidth?: boolean;
}

export function ConfirmDeleteButton({
  action,
  hiddenField,
  label = 'Radera',
  confirmingLabel = 'Säker?',
  confirmedLabel = 'Tar bort…',
  cancelLabel = 'Avbryt',
  description,
  variant = 'default',
  fullWidth = false
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
        setConfirming(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Något gick fel.');
      }
    });
  }

  const triggerClasses = (() => {
    const base = 'inline-flex items-center justify-center rounded-full text-sm font-semibold transition disabled:opacity-60';
    const width = fullWidth ? ' w-full' : '';
    if (variant === 'ghost') {
      return `${base}${width} px-3 py-1.5 text-xs text-movexum-morkorange hover:bg-movexum-pastell-orange/40 dark:text-movexum-pastell-orange dark:hover:bg-movexum-morkorange/40`;
    }
    if (variant === 'subtle') {
      return `${base}${width} border border-default bg-surface px-4 py-2 text-foreground-muted hover:bg-canvas-subtle`;
    }
    return `${base}${width} bg-movexum-pastell-orange px-4 py-2 text-movexum-morkorange hover:bg-movexum-orange/30 dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange`;
  })();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={triggerClasses}
      >
        {label}
      </button>
    );
  }

  return (
    <form action={submit} className="inline-flex flex-col gap-2 rounded-2xl border border-default bg-canvas-subtle p-3">
      <input type="hidden" name={hiddenField.name} value={hiddenField.value} />
      {description ? (
        <p className="text-xs text-foreground-muted">{description}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-movexum-pastell-orange px-3 py-1.5 text-xs font-semibold text-movexum-morkorange transition hover:bg-movexum-orange/40 disabled:opacity-60 dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange"
        >
          {pending ? confirmedLabel : 'Ja, radera'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <span className="text-xs text-foreground-subtle">{confirmingLabel}</span>
      </div>
      {error ? (
        <p className="text-[11.5px] text-movexum-morkorange dark:text-movexum-pastell-orange">{error}</p>
      ) : null}
    </form>
  );
}
