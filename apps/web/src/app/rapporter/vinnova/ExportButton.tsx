'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import { exportLagesredovisningAction } from '@/lib/actions/vinnova-reports';

export function ExportButton({ from, to }: { from: string; to: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  function onExport() {
    setError(null);
    setUrl(null);
    startTransition(async () => {
      const res = await exportLagesredovisningAction({ from, to });
      if (res.error) setError(res.error);
      else if (res.downloadUrl) setUrl(res.downloadUrl);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onExport}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
      >
        <Icon name="doc" size={12} /> {pending ? 'Genererar…' : 'Exportera xlsx'}
      </button>
      {url && (
        <a
          href={url}
          className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12.5px] font-medium text-link hover:bg-canvas-muted"
        >
          <Icon name="download" size={12} /> Ladda ned filen
        </a>
      )}
      {error && <span className="text-[12px] text-movexum-morkorange">{error}</span>}
    </div>
  );
}
