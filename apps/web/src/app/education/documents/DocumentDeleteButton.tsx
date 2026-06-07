'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteEducationDocumentAction,
  deleteDocumentAssignmentAction
} from '@/lib/actions/education-documents';

interface DocumentDeleteButtonProps {
  id: string;
  kind: 'document' | 'assignment';
  label?: string;
  confirmText?: string;
}

export function DocumentDeleteButton({
  id,
  kind,
  label = 'Ta bort',
  confirmText = 'Ta bort? Detta går inte att ångra.'
}: DocumentDeleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const result =
        kind === 'document'
          ? await deleteEducationDocumentAction(id)
          : await deleteDocumentAssignmentAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-movexum-morkorange transition hover:bg-canvas-subtle disabled:opacity-50"
      >
        {isPending ? 'Tar bort…' : label}
      </button>
      {error ? <span className="text-xs text-movexum-morkorange">{error}</span> : null}
    </span>
  );
}
