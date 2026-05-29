'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  completeDocumentAssignmentAction,
  reopenDocumentAssignmentAction
} from '@/lib/actions/education-documents';

interface DocumentCompleteButtonProps {
  assignmentId: string;
  completed: boolean;
  /** Show the "ångra" (reopen) control — staff only. */
  canReopen?: boolean;
}

export function DocumentCompleteButton({
  assignmentId,
  completed,
  canReopen = false
}: DocumentCompleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  if (completed) {
    if (!canReopen) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-movexum-morkgron dark:text-movexum-gron">
          Slutförd
        </span>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => reopenDocumentAssignmentAction(assignmentId))}
          className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-50"
        >
          {isPending ? 'Ångrar…' : 'Ångra slutförd'}
        </button>
        {error ? <span className="text-xs text-movexum-morkorange">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => completeDocumentAssignmentAction(assignmentId))}
        className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Sparar…' : 'Markera som slutförd'}
      </button>
      {error ? <span className="text-xs text-movexum-morkorange">{error}</span> : null}
    </div>
  );
}
