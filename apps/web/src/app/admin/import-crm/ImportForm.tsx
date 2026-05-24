'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  previewImportCrmAction,
  commitImportCrmAction,
  type PreviewState,
  type CommitState,
  type CrmImportSummary
} from '@/lib/actions/import-crm';

const initialPreview: PreviewState = { status: 'idle' };
const initialCommit: CommitState = { status: 'idle' };

const SHEET_LABELS: { key: keyof CrmImportSummary; label: string }[] = [
  { key: 'companies', label: 'Företag' },
  { key: 'contacts', label: 'Personer' },
  { key: 'startupContacts', label: 'Kopplingar' },
  { key: 'events', label: 'Aktiviteter' },
  { key: 'signups', label: 'Deltagare' },
  { key: 'capital', label: 'Kapital' },
  { key: 'ipr', label: 'IPR' },
  { key: 'agreements', label: 'Avtal' },
  { key: 'tasks', label: 'ToDo' },
  { key: 'kpis', label: 'Mätetal' },
  { key: 'phaseEntries', label: 'Fashistorik' }
];

export function ImportForm() {
  const commitFileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const selectedName = selectedFile?.name ?? null;

  const [previewState, previewAction, previewPending] = useActionState(
    previewImportCrmAction,
    initialPreview
  );
  const [commitState, commitAction, commitPending] = useActionState(
    commitImportCrmAction,
    initialCommit
  );

  const handlePreviewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  useEffect(() => {
    const input = commitFileRef.current;
    if (!input || !selectedFile) return;
    const dt = new DataTransfer();
    dt.items.add(selectedFile);
    input.files = dt.files;
  }, [selectedFile, previewState.status]);

  const inputClass =
    'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-foreground hover:file:bg-brand-hover focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <section className="space-y-6">
      <form
        action={previewAction}
        className="space-y-4 rounded-3xl border border-default bg-surface p-6"
      >
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-foreground">
            Välj CRM-export (.xlsx)
          </label>
          <p className="mt-1 text-xs text-foreground-subtle">
            Max 25 MB. Filen ska innehålla arken Företag, Personer,
            Företag-Person, Aktiviteter, Deltagare, Kapital, IPR, Avtal,
            ToDo och Mätetal med headers på första raden.
          </p>
        </div>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={handlePreviewFileChange}
          className={inputClass}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground-subtle">
            {selectedName ? `Vald fil: ${selectedName}` : 'Ingen fil vald'}
          </span>
          <button
            type="submit"
            disabled={previewPending}
            className="rounded-2xl bg-brand px-5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewPending ? 'Förhandsgranskar…' : 'Förhandsgranska'}
          </button>
        </div>

        {previewState.status === 'error' && (
          <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
            {previewState.message}
          </p>
        )}
      </form>

      {previewState.status === 'ok' && (
        <div className="space-y-4 rounded-3xl border border-default bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              Förhandsgranskning
            </h3>
            <span className="rounded-full bg-movexum-pastell-gron px-3 py-1 text-xs font-medium text-movexum-morkgron">
              Klar att importera
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SHEET_LABELS.map(({ key, label }) => (
              <SummaryCell
                key={key}
                label={label}
                value={String(previewState.summary[key] ?? 0)}
              />
            ))}
          </div>

          {previewState.summary.warnings.length > 0 && (
            <details className="rounded-2xl bg-movexum-pastell-gul p-4 text-sm text-movexum-morkgul">
              <summary className="cursor-pointer font-medium">
                {previewState.summary.warnings.length} varningar (klicka för att se)
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {previewState.summary.warnings.slice(0, 100).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {previewState.summary.warnings.length > 100 && (
                  <li className="italic">
                    …och {previewState.summary.warnings.length - 100} till
                  </li>
                )}
              </ul>
            </details>
          )}

          <form action={commitAction} className="pt-2">
            <input
              ref={commitFileRef}
              name="file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
            />
            <button
              type="submit"
              disabled={commitPending || commitState.status === 'ok'}
              className="w-full rounded-2xl bg-brand px-5 py-3 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {commitPending
                ? 'Importerar…'
                : commitState.status === 'ok'
                  ? 'Importerad'
                  : 'Bekräfta import till databasen'}
            </button>
            <p className="mt-2 text-xs text-foreground-subtle">
              Skriver till PocketBase i beroendeordning (företag → kontakter →
              kopplingar → events → övrigt). Befintliga rader uppdateras.
            </p>
          </form>

          {commitState.status === 'error' && (
            <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
              {commitState.message}
            </p>
          )}

          {commitState.status === 'ok' && (
            <div className="space-y-2 rounded-2xl bg-movexum-pastell-gron p-4 text-sm text-movexum-morkgron">
              <p className="font-medium">Import klar.</p>
              <ul className="list-disc space-y-1 pl-5">
                {Object.keys({
                  ...commitState.result.created,
                  ...commitState.result.updated
                })
                  .sort()
                  .map((coll) => (
                    <li key={coll}>
                      <code className="font-mono text-xs">{coll}</code>:{' '}
                      <strong>{commitState.result.created[coll] ?? 0}</strong> skapade,{' '}
                      <strong>{commitState.result.updated[coll] ?? 0}</strong> uppdaterade
                    </li>
                  ))}
                {commitState.result.skipped > 0 && (
                  <li>
                    Hoppade över: <strong>{commitState.result.skipped}</strong>{' '}
                    (saknad relation eller GDPR-samtycke)
                  </li>
                )}
              </ul>
              <p className="text-xs">
                Aktivitet loggad i feeden under{' '}
                <code className="font-mono">integration_sync</code>.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-canvas-subtle p-3">
      <div className="text-xs uppercase tracking-wide text-foreground-subtle">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
