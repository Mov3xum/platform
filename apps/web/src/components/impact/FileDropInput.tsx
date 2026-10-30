'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { Icon } from '@/components/proto/Icon';
import { hintClass } from './ui';

export const IMPACT_UPLOAD_ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md']);

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
  if (!ALLOWED_EXT.has(ext)) return `${file.name}: filformatet stöds inte (PDF, DOCX, PPTX, XLSX, CSV, TXT eller MD).`;
  if (file.size === 0) return `${file.name}: filen är tom.`;
  if (file.size > MAX_BYTES) return `${file.name}: större än 25 MB.`;
  return null;
}

/**
 * Dra-och-släpp-yta för underlag (originalets FileDropInput). Två lägen:
 * - `target` satt: varje fil laddas upp DIREKT (route handler) och
 *   `onUploaded` får dokument-id:n — formuläret skickar sedan bara id:n
 *   (server actions har en body-gräns, § 18.2).
 * - utan `target`: filerna hålls i minnet och lämnas via `onFilesChange`
 *   (används när bolaget inte finns ännu — skapa-sidan laddar upp efteråt).
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
  description: string;
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
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<UploadedImpactDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function take(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setError(null);
    const invalid = incoming.map(validateImpactUploadFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    const accepted = multiple ? incoming : incoming.slice(0, 1);
    if (!target) {
      const next = multiple ? [...files, ...accepted] : accepted;
      setFiles(next);
      onFilesChange?.(next);
      return;
    }
    setBusy(true);
    const done: UploadedImpactDocument[] = [];
    try {
      for (const file of accepted) done.push(await uploadImpactDocument(file, target));
      const next = multiple ? [...uploaded, ...done] : done;
      setUploaded(next);
      onUploaded?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uppladdningen misslyckades.');
    } finally {
      setBusy(false);
    }
  }

  function removeAt(index: number) {
    if (target) {
      const next = uploaded.filter((_, i) => i !== index);
      setUploaded(next);
      onUploaded?.(next);
    } else {
      const next = files.filter((_, i) => i !== index);
      setFiles(next);
      onFilesChange?.(next);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    void take(e.dataTransfer.files);
  }

  const rows = target ? uploaded.map((u) => ({ name: u.name, note: u.hasText ? undefined : u.warning || 'Ingen läsbar text kunde läsas ut.' })) : files.map((f) => ({ name: f.name, note: undefined }));
  const hasAny = rows.length > 0;

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? 'border-brand bg-canvas-subtle' : 'border-default bg-canvas hover:border-strong hover:bg-canvas-subtle'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-muted">
          <Icon name={busy ? 'hourglass' : 'upload'} size={18} />
        </span>
        <p className="text-sm font-medium text-foreground">
          {title}
          {required ? <span className="ml-1 text-foreground-subtle">(obligatorisk)</span> : null}
        </p>
        <p id={`${id}-desc`} className={hintClass}>
          {busy ? 'Laddar upp och läser ut text …' : description}
        </p>
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
      {hasAny ? (
        <ul className="mt-2 space-y-1">
          {rows.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-start justify-between gap-3 rounded-lg bg-canvas-subtle px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{row.name}</span>
                {row.note ? <span className="block text-xs text-movexum-morkgul">{row.note}</span> : null}
              </span>
              {!disabled ? (
                <button type="button" onClick={() => removeAt(i)} className="shrink-0 text-xs font-medium text-foreground-subtle hover:text-foreground" aria-label={`Ta bort ${row.name}`}>
                  Ta bort
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 text-xs font-medium text-movexum-morkorange">{error}</p> : null}
    </div>
  );
}
