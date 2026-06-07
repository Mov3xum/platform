'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setEducationDocumentAreaAction } from '@/lib/actions/education-documents';
import type { WorkshopArea } from '@platform/shared';

/**
 * Inline-väljare för att koppla ett befintligt utbildningsdokument till ett
 * område (precis som workshops). Sparar direkt vid ändring.
 */
export function DocumentAreaSelect({
  documentId,
  currentAreaId,
  areas
}: {
  documentId: string;
  currentAreaId: string;
  areas: WorkshopArea[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentAreaId);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setEducationDocumentAreaAction(documentId, next);
      if (res.error) {
        setError(res.error);
        setValue(previous);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-foreground-subtle">Område</label>
      <select
        value={value}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-default bg-surface px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila disabled:opacity-50 dark:focus:ring-movexum-morklila"
      >
        <option value="">Inget område</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-movexum-morkorange">{error}</span> : null}
    </div>
  );
}
