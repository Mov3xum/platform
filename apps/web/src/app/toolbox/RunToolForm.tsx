'use client';

import { useTransition, useState, useRef, useMemo } from 'react';
import { runToolAction } from '@/lib/actions/tools';
import { useRouter } from 'next/navigation';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getModelMeta
} from '@/lib/ai/models';
import type { ToolModel } from '@platform/shared';

interface RunToolFormProps {
  toolId: string;
  requiresStartup: boolean;
  isAiTool: boolean;
  startups: Array<{ id: string; name: string }>;
  defaultStartupId?: string;
  defaultModel?: ToolModel;
}

const ACCEPT_MIME =
  'image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RunToolForm({
  toolId,
  requiresStartup,
  isAiTool,
  startups,
  defaultStartupId,
  defaultModel
}: RunToolFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [startupId, setStartupId] = useState(defaultStartupId ?? '');
  const [model, setModel] = useState<ToolModel>(defaultModel ?? DEFAULT_MODEL);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasImages = useMemo(() => files.some((f) => f.type.startsWith('image/')), [files]);
  const meta = getModelMeta(model);
  const visionMismatch = hasImages && !meta.supportsVision;

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(incoming)].slice(0, 5));
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (visionMismatch) {
      setError('Vald modell saknar stöd för bilder. Byt till Mistral Medium eller Pixtral Large.');
      return;
    }

    const formData = new FormData();
    formData.append('toolId', toolId);
    if (startupId) formData.append('startupId', startupId);
    if (isAiTool) formData.append('modelOverride', model);
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    startTransition(async () => {
      const result = await runToolAction(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.runId) {
        router.push(`/toolbox/runs/${result.runId}`);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {requiresStartup && (
        <div>
          <label htmlFor="startup" className="block text-sm font-medium text-foreground-muted">
            Välj bolag *
          </label>
          <select
            id="startup"
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            required
            className="mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          >
            <option value="">-- Välj bolag --</option>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isAiTool && (
        <div>
          <label htmlFor="model" className="block text-sm font-medium text-foreground-muted">
            Modell
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value as ToolModel)}
            className="mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          >
            {AVAILABLE_MODELS.map((m) => {
              const disabled = hasImages && !m.supportsVision;
              return (
                <option key={m.id} value={m.id} disabled={disabled}>
                  {m.label} · {m.blurb} · ${m.priceInPerMillion.toFixed(2)}/$
                  {m.priceOutPerMillion.toFixed(2)} per 1M
                  {disabled ? ' (kräver vision)' : ''}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-foreground-subtle">
            Pris: ${meta.priceInPerMillion}/$ {meta.priceOutPerMillion} per 1M tokens (in/ut).
            {meta.supportsVision ? ' Stödjer bilder.' : ' Endast text.'}
          </p>
        </div>
      )}

      {isAiTool && (
        <div>
          <label className="block text-sm font-medium text-foreground-muted">
            Bilagor (max 5 filer, 10 MB/fil)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-default bg-surface px-4 py-2 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              + Lägg till fil
            </button>
            <span className="text-xs text-foreground-subtle">
              PNG, JPG, WebP, PDF, TXT, MD, CSV
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_MIME}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between rounded-2xl border border-default bg-surface px-3 py-2 text-xs"
                >
                  <span className="truncate text-foreground">
                    {f.type.startsWith('image/') ? '🖼️' : f.type === 'application/pdf' ? '📄' : '📝'}{' '}
                    {f.name}{' '}
                    <span className="text-foreground-subtle">({formatFileSize(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="ml-3 text-foreground-subtle hover:text-foreground"
                    aria-label="Ta bort fil"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {visionMismatch && (
            <p className="mt-2 text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
              Du har bifogat bilder. Välj Mistral Medium eller Pixtral Large.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || (requiresStartup && !startupId) || visionMismatch}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Kör…' : 'Kör agent'}
      </button>

      {isPending && (
        <p className="text-center text-xs text-foreground-muted">
          AI-svar kan ta upp till 30 sekunder…
        </p>
      )}
    </form>
  );
}
