'use client';

import { useRef, useState, useTransition } from 'react';
import {
  previewVinnovaImportAction,
  commitVinnovaImportAction,
  type VinnovaImportPreview,
  type VinnovaImportCommit
} from '@/lib/actions/import-vinnova';

const KIND_LABEL: Record<string, string> = {
  lagesredovisning: 'Lägesredovisning aktiebolag',
  tid: 'Inrapporterad tid',
  kostnader: 'Kostnader bolag',
  unknown: 'Okänd'
};

export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<VinnovaImportPreview | null>(null);
  const [committed, setCommitted] = useState<VinnovaImportCommit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsDate = preview?.kind === 'tid' || preview?.kind === 'kostnader';

  function buildFormData(): FormData | null {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en fil först.');
      return null;
    }
    const fd = new FormData();
    fd.append('file', file);
    if (date) fd.append('occurred_on', date);
    return fd;
  }

  function onPreview() {
    setError(null);
    setCommitted(null);
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      const res = await previewVinnovaImportAction(fd);
      if (res.error) {
        setError(res.error);
        setPreview(null);
      } else {
        setPreview(res);
      }
    });
  }

  function onCommit() {
    setError(null);
    const fd = buildFormData();
    if (!fd) return;
    if (needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Ange ett periodatum (YYYY-MM-DD).');
      return;
    }
    startTransition(async () => {
      const res = await commitVinnovaImportAction(fd);
      if (res.error) setError(res.error);
      else setCommitted(res);
    });
  }

  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <h2 className="text-base font-semibold text-foreground">Ladda upp fil</h2>

      <div className="mt-4 space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-brand-foreground"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPreview}
            disabled={pending}
            className="rounded-lg border border-default px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-canvas-muted disabled:opacity-60"
          >
            {pending ? 'Läser…' : 'Förhandsgranska'}
          </button>
          {preview && (
            <>
              {needsDate && (
                <label className="flex items-center gap-2 text-[12.5px] text-foreground-muted">
                  Periodatum
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-lg border border-default bg-canvas px-2 py-1 text-[12.5px] text-foreground"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={onCommit}
                disabled={pending}
                className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
              >
                {pending ? 'Importerar…' : 'Importera'}
              </button>
            </>
          )}
        </div>

        {error && <p className="text-[13px] text-movexum-morkorange">{error}</p>}

        {preview && (
          <div className="rounded-2xl border border-default bg-canvas-subtle p-4 text-[13px]">
            <div className="font-medium text-foreground">
              Identifierad fil: {KIND_LABEL[preview.kind || 'unknown']}
            </div>
            <div className="mt-1 text-foreground-muted">
              {preview.matched} av {preview.rowCount} rader matchade befintliga bolag.
            </div>
            {preview.unmatched && preview.unmatched.length > 0 && (
              <div className="mt-2 text-foreground-muted">
                Ej matchade (hoppas över): {preview.unmatched.slice(0, 20).join(', ')}
                {preview.unmatched.length > 20 ? '…' : ''}
              </div>
            )}
            {preview.warnings && preview.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-movexum-morkgul">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {committed && (
          <div className="rounded-2xl border border-default bg-movexum-pastell-gron p-4 text-[13px] text-movexum-morkgron">
            Import klar ({KIND_LABEL[committed.kind || 'unknown']}):
            {committed.startupsUpdated ? ` ${committed.startupsUpdated} bolag uppdaterade,` : ''}
            {committed.aidPeriods ? ` ${committed.aidPeriods} statsstödsperioder,` : ''}
            {committed.readiness ? ` ${committed.readiness} readiness-bedömningar,` : ''}
            {committed.timeEntries ? ` ${committed.timeEntries} tidsposter,` : ''}
            {committed.costs ? ` ${committed.costs} kostnader,` : ''}
            {` ${committed.skipped || 0} hoppade över.`}
          </div>
        )}
      </div>
    </section>
  );
}
