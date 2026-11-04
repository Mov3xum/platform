'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { deleteImpactDocumentAction } from '@/lib/actions/impact';
import { Icon } from '@/components/proto/Icon';
import { hintClass } from './ui';

export const IMPACT_UPLOAD_ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md']);
/** Originalets standardtext under rubriken. */
const DEFAULT_DESCRIPTION = 'PDF, Word, PowerPoint, Excel, CSV, text eller Markdown fungerar.';

export interface UploadedImpactDocument {
  id: string;
  name: string;
  hasText: boolean;
  warning?: string;
}

export interface ImpactUploadTarget {
  startupId: string;
  assessmentId?: string;
  gapQuestionId?: string;
  stage: 'idea_description' | 'full_information' | 'gap_response' | 'update';
}

/** Laddar upp EN fil till route-handlern (§ 18.2) och returnerar dokumentraden. */
export async function uploadImpactDocument(file: File, target: ImpactUploadTarget): Promise<UploadedImpactDocument> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('startup_id', target.startupId);
  fd.append('stage', target.stage);
  if (target.assessmentId) fd.append('assessment_id', target.assessmentId);
  if (target.gapQuestionId) fd.append('gap_question_id', target.gapQuestionId);
  const res = await fetch('/api/impactnavigator/documents', { method: 'POST', body: fd, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; hasText?: boolean; warning?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error || `Uppladdningen misslyckades (HTTP ${res.status}).`);
  return { id: body.id, name: body.name || file.name, hasText: Boolean(body.hasText), warning: body.warning };
}

export function validateImpactUploadFile(file: File): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_EXT.has(ext) || file.size > MAX_BYTES) return `Filen ${file.name} har en typ som inte stöds eller är större än 25 MB.`;
  if (file.size === 0) return `Filen ${file.name} är tom.`;
  return null;
}

/**
 * Dra-och-släpp-yta för underlag (originalets FileDropInput). Två lägen:
 * - `target` satt: varje fil laddas upp DIREKT (route handler) och
 *   `onUploaded` får dokument-id:n — formuläret skickar sedan bara id:n
 *   (server actions har en body-gräns, § 18.2). "Ta bort" raderar då också
 *   dokumentet på servern så det aldrig matar analysen.
 * - utan `target`: filerna hålls i minnet och lämnas via `onFilesChange`
 *   (används när bolaget inte finns ännu — skapa-sidan laddar upp efteråt).
 * Som originalet spärrar `setCustomValidity` formuläret medan en uppladdning
 * pågår ("Vänta tills filuppladdningen är klar.") och när en obligatorisk fil
 * saknas ("Välj en fil.").
 */
export function FileDropInput({
  title,
  description,
  multiple,
  required,
  disabled,
  target,
  onUploaded,
  onFilesChange,
  className
}: {
  title: string;
  description?: string;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  target?: ImpactUploadTarget;
  onUploaded?: (docs: UploadedImpactDocument[]) => void;
  onFilesChange?: (files: File[]) => void;
  className?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const validityRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<UploadedImpactDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileWord = multiple ? 'filer' : 'fil';
  const actionLabel = multiple ? 'Välj filer' : 'Välj fil';
  const rows = target
    ? uploaded.map((u) => ({ key: u.id, name: u.name, note: u.hasText ? undefined : u.warning || 'Ingen läsbar text kunde läsas ut.' }))
    : files.map((f, i) => ({ key: `${f.name}-${i}`, name: f.name, note: undefined }));
  const hasSelection = rows.length > 0;

  function setValidity(message: string) {
    validityRef.current?.setCustomValidity(message);
  }

  async function take(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setError(null);
    const invalid = incoming.map(validateImpactUploadFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      setValidity(invalid);
      validityRef.current?.reportValidity();
      return;
    }
    const accepted = multiple ? incoming : incoming.slice(0, 1);
    if (!target) {
      const next = multiple ? [...files, ...accepted] : accepted;
      setFiles(next);
      setValidity('');
      onFilesChange?.(next);
      return;
    }
    setBusy(true);
    setProgress(0);
    setValidity('Vänta tills filuppladdningen är klar.');
    const done: UploadedImpactDocument[] = [];
    try {
      for (const [i, file] of accepted.entries()) {
        done.push(await uploadImpactDocument(file, target));
        setProgress(Math.round(((i + 1) / accepted.length) * 100));
      }
      const next = multiple ? [...uploaded, ...done] : done;
      setUploaded(next);
      setValidity('');
      onUploaded?.(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Filerna kunde inte laddas upp. Försök igen.';
      setError(message);
      setValidity(message);
      validityRef.current?.reportValidity();
      if (done.length) {
        const next = multiple ? [...uploaded, ...done] : done;
        setUploaded(next);
        onUploaded?.(next);
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeAt(index: number) {
    if (target) {
      const doc = uploaded[index];
      const next = uploaded.filter((_, i) => i !== index);
      setUploaded(next);
      onUploaded?.(next);
      if (required && next.length === 0) setValidity('Välj en fil.');
      if (doc) {
        const res = await deleteImpactDocumentAction(target.startupId, doc.id);
        if (res.error) setError(`${doc.name}: ${res.error}`);
      }
    } else {
      const next = files.filter((_, i) => i !== index);
      setFiles(next);
      if (required && next.length === 0) setValidity('Välj en fil.');
      onFilesChange?.(next);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    void take(e.dataTransfer.files);
  }

  const headline = busy ? `Laddar upp ${progress} %` : hasSelection ? (target ? 'Uppladdning klar' : `${rows.length} ${rows.length === 1 ? 'fil vald' : 'filer valda'}`) : `Dra ${fileWord} hit eller använd knappen`;

  return (
    <div className={className}>
      {/* Osynligt fält som bär formulärets validering (originalets setCustomValidity på filfältet). */}
      <input ref={validityRef} tabIndex={-1} aria-hidden="true" required={required && !hasSelection} defaultValue="" className="sr-only" onInvalid={(e) => {
          e.preventDefault();
          setError(e.currentTarget.validationMessage || 'Välj en fil.');
        }}
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${title}. Dra ${fileWord} hit eller använd knappen ${actionLabel}.`}
        aria-describedby={`${id}-desc`}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col gap-4 rounded-xl border-2 border-dashed px-4 py-5 transition sm:flex-row sm:items-center sm:justify-between ${
          dragging ? 'border-movexum-gron bg-movexum-pastell-gron/40 dark:bg-movexum-morkgron/20' : hasSelection ? 'border-movexum-gron/40 bg-movexum-pastell-gron/30 dark:bg-movexum-morkgron/20' : 'border-default bg-canvas hover:border-strong hover:bg-canvas-subtle'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hasSelection && !busy ? 'bg-surface text-movexum-gron shadow-sm dark:text-movexum-ljusgron' : 'bg-canvas-muted text-foreground-muted'}`}>
            <Icon name={busy ? 'hourglass' : hasSelection ? 'check' : 'upload'} size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {title}
              {required ? <span className="ml-1 text-foreground-subtle">(obligatorisk)</span> : null}
            </p>
            <p className="text-sm text-foreground-muted">{headline}</p>
            <p id={`${id}-desc`} className={hintClass}>
              {description ?? DEFAULT_DESCRIPTION}
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center justify-center rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-movexum-gron shadow-sm dark:text-movexum-ljusgron">
          {busy ? 'Laddar upp' : hasSelection ? (multiple ? 'Byt filer' : 'Byt fil') : actionLabel}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={IMPACT_UPLOAD_ACCEPT}
          multiple={multiple}
          disabled={disabled || busy}
          className="sr-only"
          onChange={(e) => {
            if (e.currentTarget.files) void take(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>
      {hasSelection ? (
        <ul className="mt-2 space-y-1">
          {rows.map((row, i) => (
            <li key={row.key} className="flex items-start justify-between gap-3 rounded-lg bg-canvas-subtle px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{row.name}</span>
                {row.note ? <span className="block text-xs text-movexum-morkgul">{row.note}</span> : null}
              </span>
              {!disabled ? (
                <button type="button" onClick={() => void removeAt(i)} className="shrink-0 text-xs font-medium text-foreground-subtle hover:text-foreground" aria-label={`Ta bort ${row.name}`}>
                  Ta bort
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-movexum-morkorange">
          {error}
        </p>
      ) : null}
    </div>
  );
}
