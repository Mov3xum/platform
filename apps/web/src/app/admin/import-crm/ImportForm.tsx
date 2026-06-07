'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import type { AnalyzeState, RunState, SheetOutcome } from '@/lib/actions/import-general';
import type { ImportCollection } from '@/lib/import/importable';
import type { AnalyzedSheet, SheetMapping } from '@/lib/import/mapping';
import {
  suggestCollection,
  suggestColumns,
  suggestUpsertKeys
} from '@/lib/import/mapping';

const fileInputClass =
  'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-foreground hover:file:bg-brand-hover focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const selectClass =
  'rounded-xl border border-default bg-surface px-3 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const btnPrimary =
  'rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost =
  'rounded-2xl border border-default bg-surface px-5 py-2.5 text-sm font-medium text-foreground-muted hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50';

async function parseImportResponse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T;
  return data;
}

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<{
    sheets: AnalyzedSheet[];
    collections: ImportCollection[];
  } | null>(null);
  const [config, setConfig] = useState<SheetMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RunState | null>(null);
  const [commit, setCommit] = useState<RunState | null>(null);
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<'analyze' | 'preview' | 'commit' | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const collByName = useMemo(
    () => new Map((analysis?.collections ?? []).map((c) => [c.name, c])),
    [analysis]
  );

  function buildInitialConfig(
    sheets: AnalyzedSheet[],
    collections: ImportCollection[]
  ): SheetMapping[] {
    return sheets.map((sheet) => {
      const collName = suggestCollection(sheet.sheet, collections);
      const coll = collName ? collections.find((c) => c.name === collName) : undefined;
      const columns = suggestColumns(sheet.headers, coll);
      return {
        sheet: sheet.sheet,
        collection: collName,
        upsertKeys: suggestUpsertKeys(columns),
        columns
      };
    });
  }

  function runAnalyze() {
    if (!file) return;
    setError(null);
    setPreview(null);
    setCommit(null);
    setStage('analyze');
    startTransition(async () => {
      const fd = new FormData();
      fd.append('action', 'analyze');
      fd.append('file', file);
      const res = await fetch('/api/admin/import-crm', { method: 'POST', body: fd });
      const data = await parseImportResponse<AnalyzeState>(res);
      if (!res.ok || data.status === 'error') {
        setError(data.status === 'error' ? data.message : 'Kunde inte analysera filen.');
        setAnalysis(null);
      } else if (data.status === 'ok') {
        setAnalysis({ sheets: data.sheets, collections: data.collections });
        setConfig(buildInitialConfig(data.sheets, data.collections));
      }
      setStage(null);
    });
  }

  function runStage(kind: 'preview' | 'commit') {
    if (!file) return;
    setError(null);
    setStage(kind);
    startTransition(async () => {
      const fd = new FormData();
      fd.append('action', kind);
      fd.append('file', file);
      fd.append('config', JSON.stringify({ sheets: config }));
      const res = await fetch('/api/admin/import-crm', { method: 'POST', body: fd });
      const data = await parseImportResponse<RunState>(res);
      if (!res.ok || data.status === 'error') {
        setError(data.status === 'error' ? data.message : 'Kunde inte köra importen.');
        if (kind === 'preview') setPreview(data);
        else setCommit(data);
      } else {
        if (kind === 'preview') setPreview(data);
        else setCommit(data);
      }
      setStage(null);
    });
  }

  // ── Mappnings-mutationer ───────────────────────────────────────────
  function setSheetCollection(idx: number, collName: string | null) {
    setConfig((prev) =>
      prev.map((sm, i) => {
        if (i !== idx) return sm;
        const sheet = analysis?.sheets.find((s) => s.sheet === sm.sheet);
        const coll = collName ? collByName.get(collName) : undefined;
        const columns = sheet ? suggestColumns(sheet.headers, coll) : sm.columns;
        return {
          ...sm,
          collection: collName,
          columns,
          upsertKeys: suggestUpsertKeys(columns)
        };
      })
    );
    setPreview(null);
    setCommit(null);
  }

  function setColumnField(idx: number, colIdx: number, field: string | null) {
    setConfig((prev) =>
      prev.map((sm, i) =>
        i === idx
          ? {
              ...sm,
              columns: sm.columns.map((c, ci) => (ci === colIdx ? { ...c, field } : c)),
              upsertKeys: sm.upsertKeys.filter((k) =>
                sm.columns.some((c, ci) => (ci === colIdx ? field === k : c.field === k))
              )
            }
          : sm
      )
    );
    setPreview(null);
    setCommit(null);
  }

  function toggleUpsertKey(idx: number, field: string) {
    setConfig((prev) =>
      prev.map((sm, i) =>
        i === idx
          ? {
              ...sm,
              upsertKeys: sm.upsertKeys.includes(field)
                ? sm.upsertKeys.filter((k) => k !== field)
                : [...sm.upsertKeys, field]
            }
          : sm
      )
    );
    setPreview(null);
    setCommit(null);
  }

  const committed = commit?.status === 'ok' && !commit.dryRun;

  return (
    <section className="space-y-6">
      {/* Steg 1 — välj fil */}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          runAnalyze();
        }}
        className="space-y-4 rounded-3xl border border-default bg-surface p-6"
      >
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-foreground">
            1. Välj Excel-fil (.xlsx)
          </label>
          <p className="mt-1 text-xs text-foreground-subtle">
            Max 25 MB. Varje ark läses separat — du väljer själv vilken tabell
            det ska mappas till. Rubriker förväntas på första raden.
          </p>
        </div>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setAnalysis(null);
            setPreview(null);
            setCommit(null);
          }}
          className={fileInputClass}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground-subtle">
            {file ? `Vald fil: ${file.name}` : 'Ingen fil vald'}
          </span>
          <button type="submit" disabled={!file || pending} className={btnPrimary}>
            {stage === 'analyze' ? 'Analyserar…' : 'Analysera fil'}
          </button>
        </div>
        {error && (
          <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
            {error}
          </p>
        )}
      </form>

      {/* Steg 2 — mappning per ark */}
      {analysis && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">
            2. Mappa ark → tabeller och kolumner → fält
          </h3>
          {analysis.sheets.map((sheet, idx) => (
            <SheetCard
              key={sheet.sheet}
              sheet={sheet}
              mapping={config[idx]}
              collections={analysis.collections}
              onSetCollection={(name) => setSheetCollection(idx, name)}
              onSetColumnField={(colIdx, field) => setColumnField(idx, colIdx, field)}
              onToggleUpsertKey={(field) => toggleUpsertKey(idx, field)}
            />
          ))}

          {/* Steg 3 — förhandsgranska + commit */}
          <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-default bg-surface p-6">
            <button
              type="button"
              onClick={() => runStage('preview')}
              disabled={pending || committed}
              className={btnGhost}
            >
              {stage === 'preview' ? 'Förhandsgranskar…' : '3. Förhandsgranska'}
            </button>
            <button
              type="button"
              onClick={() => runStage('commit')}
              disabled={pending || committed}
              className={btnPrimary}
            >
              {stage === 'commit'
                ? 'Importerar…'
                : committed
                  ? 'Importerad ✓'
                  : '4. Bekräfta import'}
            </button>
            <span className="text-xs text-foreground-subtle">
              Förhandsgranskningen skriver inget — den visar vad som kommer med
              och vad som hoppas över.
            </span>
          </div>

          {preview?.status === 'ok' && !committed && (
            <ResultPanel run={preview} title="Förhandsgranskning (inget sparat)" />
          )}
          {commit?.status === 'ok' && (
            <ResultPanel run={commit} title="Import klar" success />
          )}
        </div>
      )}
    </section>
  );
}

// ── Per-ark-kort ────────────────────────────────────────────────────
function SheetCard({
  sheet,
  mapping,
  collections,
  onSetCollection,
  onSetColumnField,
  onToggleUpsertKey
}: {
  sheet: AnalyzedSheet;
  mapping: SheetMapping;
  collections: ImportCollection[];
  onSetCollection: (name: string | null) => void;
  onSetColumnField: (colIdx: number, field: string | null) => void;
  onToggleUpsertKey: (field: string) => void;
}) {
  const coll = mapping.collection
    ? collections.find((c) => c.name === mapping.collection)
    : undefined;
  const fields = coll?.fields ?? [];
  const mappedFields = mapping.columns.map((c) => c.field).filter((f): f is string => !!f);
  const piiMapped = fields.filter((f) => f.pii && mappedFields.includes(f.name));
  const unmapped = mapping.columns.filter((c) => !c.field);
  const requiredFields = fields.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !mappedFields.includes(f.name));
  const missingRequiredRelations = missingRequired.filter((f) => f.type === 'relation');

  return (
    <div className="space-y-4 rounded-3xl border border-default bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            Ark: <span className="font-mono">{sheet.sheet}</span>
          </h4>
          <p className="text-xs text-foreground-subtle">
            {sheet.rowCount} rader · {sheet.headers.length} kolumner
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          Importera till:
          <select
            className={selectClass}
            value={mapping.collection ?? ''}
            onChange={(e) => onSetCollection(e.target.value || null)}
          >
            <option value="">— Hoppa över arket —</option>
            {collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!mapping.collection ? (
        <p className="rounded-2xl bg-canvas-subtle px-4 py-3 text-sm text-foreground-subtle">
          Arket hoppas över — ingen data importeras.
        </p>
      ) : (
        <>
          {/* Kolumn → fält */}
          <div className="overflow-x-auto rounded-2xl border border-default">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default bg-canvas-subtle text-left text-xs uppercase tracking-wide text-foreground-subtle">
                  <th className="px-3 py-2 font-medium">Kolumn</th>
                  <th className="px-3 py-2 font-medium">Exempelvärde</th>
                  <th className="px-3 py-2 font-medium">Mappa till fält</th>
                  <th className="px-3 py-2 font-medium">Nyckel</th>
                </tr>
              </thead>
              <tbody>
                {mapping.columns.map((col, ci) => {
                  const sampleVal = sheet.sample[0]?.[ci] ?? '';
                  const fieldDef = col.field ? fields.find((f) => f.name === col.field) : undefined;
                  return (
                    <tr key={col.column} className="border-b border-default last:border-0">
                      <td className="px-3 py-2 font-medium text-foreground">{col.label}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-foreground-subtle">
                        {sampleVal || <span className="italic">tomt</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={selectClass}
                          value={col.field ?? ''}
                          onChange={(e) => onSetColumnField(ci, e.target.value || null)}
                        >
                          <option value="">— Ignorera —</option>
                          {fields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                              {f.required ? ' *' : ''} ({f.type})
                              {f.pii ? ' ⚠ PII' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {fieldDef ? (
                          <input
                            type="checkbox"
                            checked={mapping.upsertKeys.includes(fieldDef.name)}
                            onChange={() => onToggleUpsertKey(fieldDef.name)}
                            title="Använd som nyckel för att hitta/uppdatera befintliga rader"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-foreground-subtle">
            <strong>Nyckel</strong> = fält som matchar befintliga rader (upsert).
            Inga nyckelval ⇒ varje rad skapas som ny. <span className="mx-1">·</span>
            <span className="text-movexum-morkorange">⚠ PII</span> = känsligt fält
            (personnummer saneras automatiskt i textfält).
          </p>

          {missingRequired.length > 0 && (
            <div className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
              <strong>Obligatoriska fält saknar mappning:</strong>{' '}
              {missingRequired.map((f) => f.name).join(', ')}.
              {missingRequiredRelations.length > 0 ? (
                <span>
                  {' '}
                  Minst en av dem är en relation, så den här importen kan inte skapa rader
                  förrän du mappar en kolumn till rätt koppling. För kapital/import av bolagsdata
                  betyder det normalt att du ska mappa <strong>Företagsnamn</strong> till
                  <strong>startup</strong> och låta externa käll-ID:n som <strong>FöretagsID</strong>
                  vara ignorerade. Om bolaget inte finns i databasen ännu måste det läggas in
                  först, eller så behöver du använda en specialimport för den tabellen.
                </span>
              ) : (
                <span>
                  {' '}
                  Den här tabellen kan fortfarande förhandsgranskas, men rader med saknade
                  obligatoriska fält kommer att hoppas över.
                </span>
              )}
            </div>
          )}

          {unmapped.length > 0 && (
            <div className="rounded-2xl bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul">
              <strong>Kommer inte med</strong> ({unmapped.length} kolumner):{' '}
              {unmapped.map((c) => c.label).join(', ')}
            </div>
          )}
          {piiMapped.length > 0 && (
            <div className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
              <strong>Känsliga fält mappade:</strong>{' '}
              {piiMapped.map((f) => f.name).join(', ')}. Kontrollera att GDPR-grund
              finns innan import.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Resultatpanel (delas av preview + commit) ──────────────────────
function ResultPanel({
  run,
  title,
  success
}: {
  run: Extract<RunState, { status: 'ok' }>;
  title: string;
  success?: boolean;
}) {
  return (
    <div
      className={`space-y-4 rounded-3xl border border-default p-6 ${
        success ? 'bg-movexum-pastell-gron' : 'bg-surface'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3
          className={`text-base font-semibold ${
            success ? 'text-movexum-morkgron' : 'text-foreground'
          }`}
        >
          {title}
        </h3>
        <span className="text-sm text-foreground-muted">
          {run.totals.created} skapade · {run.totals.updated} uppdaterade
          {run.totals.skipped > 0 ? ` · ${run.totals.skipped} hoppade över` : ''}
        </span>
      </div>

      <div className="space-y-3">
        {run.sheets.map((s) => (
          <SheetResult key={`${s.sheet}-${s.collection}`} outcome={s} />
        ))}
      </div>
    </div>
  );
}

function SheetResult({ outcome }: { outcome: SheetOutcome }) {
  return (
    <div className="rounded-2xl border border-default bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          <span className="font-mono">{outcome.sheet}</span> →{' '}
          <span className="font-mono">{outcome.collection}</span>
        </span>
        <span className="text-foreground-muted">
          {outcome.created} skapade · {outcome.updated} uppdaterade
          {outcome.skipped > 0 ? ` · ${outcome.skipped} hoppade över` : ''} (av{' '}
          {outcome.totalRows})
        </span>
      </div>
      {outcome.unmappedColumns.length > 0 && (
        <p className="mt-2 text-xs text-foreground-subtle">
          Ej importerade kolumner: {outcome.unmappedColumns.join(', ')}
        </p>
      )}
      {outcome.issues.length > 0 && (
        <details className="mt-2 text-xs text-movexum-morkgul">
          <summary className="cursor-pointer font-medium">
            {outcome.issues.length} anmärkningar
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {outcome.issues.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
