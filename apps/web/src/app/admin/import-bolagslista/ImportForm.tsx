'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  previewImportBolagslistaAction,
  commitImportBolagslistaAction,
  type PreviewState,
  type CommitState
} from '@/lib/actions/import-bolagslista';

const initialPreview: PreviewState = { status: 'idle' };
const initialCommit: CommitState = { status: 'idle' };

function formatSek(n: number): string {
  return n.toLocaleString('sv-SE') + ' kr';
}

export function ImportForm() {
  const previewFormRef = useRef<HTMLFormElement>(null);
  const commitFormRef = useRef<HTMLFormElement>(null);
  const previewFileRef = useRef<HTMLInputElement>(null);
  const commitFileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const selectedName = selectedFile?.name ?? null;

  const [previewState, previewAction, previewPending] = useActionState(
    previewImportBolagslistaAction,
    initialPreview
  );
  const [commitState, commitAction, commitPending] = useActionState(
    commitImportBolagslistaAction,
    initialCommit
  );

  const handlePreviewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  };

  // Synka vald fil till commit-formens dolda input. Effekten kör om när
  // previewState går till 'ok' (då commit-formen monteras), så vi missar
  // inte synken om filen valdes innan commit-formen fanns i DOM.
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
        ref={previewFormRef}
        action={previewAction}
        className="space-y-4 rounded-3xl border border-default bg-surface p-6"
      >
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-foreground">
            Välj Bolagslista (.xlsx)
          </label>
          <p className="mt-1 text-xs text-foreground-subtle">
            Max 25 MB. Filen måste innehålla en flik som heter Bolagslista
            med headers Bolag / Org.nr / Kommun / Status / Intagsdatum /
            Avslutsdatum på rad 3, följt av 14 år × 4 kolumner (Antal anställda,
            Omsättning, Personalkostnad, Bolagsskatt).
          </p>
        </div>
        <input
          ref={previewFileRef}
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
            <SummaryCell
              label="Bolag"
              value={previewState.summary.totalCompanies.toString()}
            />
            <SummaryCell
              label="Financial-rader"
              value={previewState.summary.totalFinancialRows.toString()}
            />
            <SummaryCell
              label="Årsspann"
              value={`${previewState.summary.yearRange.min}–${previewState.summary.yearRange.max}`}
            />
            <SummaryCell
              label="Varningar"
              value={previewState.summary.warnings.length.toString()}
            />
          </div>

          <div className="rounded-2xl bg-canvas-subtle p-4 text-sm">
            <p className="font-medium text-foreground">
              Kontrollsummor (för verifiering)
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ChecksumRow
                label="Omsättning 2023"
                value={formatSek(previewState.summary.checksums.revenue2023Sek)}
              />
              <ChecksumRow
                label="Anställda 2023"
                value={previewState.summary.checksums.employees2023.toString()}
              />
              <ChecksumRow
                label="Omsättning 2022"
                value={formatSek(previewState.summary.checksums.revenue2022Sek)}
              />
              <ChecksumRow
                label="Anställda 2022"
                value={previewState.summary.checksums.employees2022.toString()}
              />
            </dl>
          </div>

          {previewState.summary.warnings.length > 0 && (
            <details className="rounded-2xl bg-movexum-pastell-gul p-4 text-sm text-movexum-morkgul">
              <summary className="cursor-pointer font-medium">
                {previewState.summary.warnings.length} varningar (klicka för att se)
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {previewState.summary.warnings.slice(0, 50).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {previewState.summary.warnings.length > 50 && (
                  <li className="italic">
                    …och {previewState.summary.warnings.length - 50} till
                  </li>
                )}
              </ul>
            </details>
          )}

          <form ref={commitFormRef} action={commitAction} className="pt-2">
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
              Skriver till PocketBase. Befintliga rader uppdateras, nya skapas.
              Inga rader raderas.
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
              <ul className="list-disc pl-5">
                <li>
                  Bolag: <strong>{commitState.result.startupsCreated}</strong> skapade,{' '}
                  <strong>{commitState.result.startupsUpdated}</strong> uppdaterade
                </li>
                <li>
                  Financial-rader:{' '}
                  <strong>{commitState.result.financialsCreated}</strong> skapade,{' '}
                  <strong>{commitState.result.financialsUpdated}</strong> uppdaterade
                </li>
                {commitState.result.skipped > 0 && (
                  <li>
                    Hoppade över: <strong>{commitState.result.skipped}</strong>
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

function ChecksumRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground-subtle">{label}</dt>
      <dd className="font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}
