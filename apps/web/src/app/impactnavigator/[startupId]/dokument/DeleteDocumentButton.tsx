'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteImpactDocumentAction } from '@/lib/actions/impact';

export function DeleteDocumentButton({ startupId, documentId, name }: { startupId: string; documentId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Ta bort "${name}"? Dokumentet tas bort ur underlaget; redan skapade analyser ändras inte.`)) return;
          setError(null);
          start(async () => {
            const res = await deleteImpactDocumentAction(startupId, documentId);
            if (res.error) setError(res.error);
            router.refresh();
          });
        }}
        className="text-xs font-medium text-foreground-subtle hover:text-movexum-morkorange disabled:opacity-60"
      >
        {pending ? 'Tar bort …' : 'Ta bort'}
      </button>
      {error ? <p className="mt-1 text-xs text-movexum-morkorange">{error}</p> : null}
    </>
  );
}
