'use client';

import { useTransition, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { runConnectorTurnAction } from '@/lib/actions/connectors';
import {
  AVAILABLE_MODELS,
  defaultModelForConnectors,
  getModelMeta
} from '@/lib/ai/models';
import type { ToolModel } from '@platform/shared';

interface ConnectorChatFormProps {
  kind: 'builtin' | 'mcp';
  connectorId: string;
  runId?: string;
  defaultModel?: ToolModel;
}

const ACCEPT_MIME =
  'image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConnectorChatForm({
  kind,
  connectorId,
  runId,
  defaultModel
}: ConnectorChatFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [model, setModel] = useState<ToolModel>(
    defaultModel ?? defaultModelForConnectors()
  );
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasImages = useMemo(() => files.some((f) => f.type.startsWith('image/')), [files]);
  const meta = getModelMeta(model);
  const visionMismatch = hasImages && !meta.supportsVision;
  const builtinMismatch = !meta.supportsBuiltinTools;

  const submit = () => {
    if (visionMismatch) {
      setError('Vald modell saknar stöd för bilder. Byt till Mistral Medium eller Pixtral Large.');
      return;
    }
    if (builtinMismatch) {
      setError('Connectors stöds bara av Mistral Large eller Medium.');
      return;
    }
    if (!text.trim() && files.length === 0) {
      setError('Skriv ett meddelande eller bifoga en fil.');
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('connectorId', connectorId);
    if (runId) formData.append('runId', runId);
    formData.append('userMessage', text);
    formData.append('modelOverride', model);
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    startTransition(async () => {
      const result = await runConnectorTurnAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setText('');
        setFiles([]);
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3 rounded-3xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="Skriv ditt meddelande… (Shift+Enter för ny rad)"
        className="w-full resize-y rounded-2xl border border-default bg-canvas px-4 py-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-2xl border border-default bg-canvas-subtle px-3 py-2 text-xs"
            >
              <span className="truncate text-foreground">
                {f.type.startsWith('image/') ? '🖼️' : f.type === 'application/pdf' ? '📄' : '📝'}{' '}
                {f.name}{' '}
                <span className="text-foreground-subtle">({formatFileSize(f.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
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
        <p className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          Du har bifogat bilder. Välj Mistral Medium eller Pixtral Large.
        </p>
      )}

      {builtinMismatch && (
        <p className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          Vald modell stödjer inte connectors. Välj Mistral Large eller Medium.
        </p>
      )}

      {error && (
        <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full border border-default bg-surface px-3 py-2 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          + Bilaga
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_MIME}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              setFiles((prev) => [...prev, ...Array.from(e.target.files!)].slice(0, 5));
            }
            e.target.value = '';
          }}
        />

        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ToolModel)}
          className="rounded-full border border-default bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        >
          {AVAILABLE_MODELS.map((m) => {
            const optDisabled =
              (hasImages && !m.supportsVision) || !m.supportsBuiltinTools;
            return (
              <option key={m.id} value={m.id} disabled={optDisabled}>
                {m.label}
                {!m.supportsBuiltinTools ? ' (saknar tool-stöd)' : ''}
                {hasImages && !m.supportsVision ? ' (kräver vision)' : ''}
              </option>
            );
          })}
        </select>

        <span className="text-xs text-foreground-subtle">
          ${meta.priceInPerMillion}/${meta.priceOutPerMillion} per 1M
        </span>

        <button
          type="submit"
          disabled={isPending || visionMismatch || builtinMismatch}
          className="ml-auto inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Skickar…' : 'Skicka'}
        </button>
      </div>
    </form>
  );
}
