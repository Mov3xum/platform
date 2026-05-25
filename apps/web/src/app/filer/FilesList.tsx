'use client';

import { useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/proto/Icon';
import {
  listFilesAction,
  getFileDownloadUrlAction,
  renameFileAction,
  deleteFileAction,
  uploadUserFileAction,
  type UserFileListItem
} from '@/lib/actions/files';

function formatBytes(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_LABEL: Record<string, string> = {
  pptx: 'PowerPoint',
  xlsx: 'Excel',
  docx: 'Word',
  pdf: 'PDF',
  other: 'Fil'
};

const KIND_TONE: Record<string, string> = {
  pptx: 'bg-movexum-pastell-orange text-movexum-morkorange',
  xlsx: 'bg-movexum-pastell-gron text-movexum-morkgron',
  docx: 'bg-movexum-pastell-bla text-movexum-djupbla',
  pdf: 'bg-movexum-pastell-lila text-movexum-morklila',
  other: 'bg-canvas-muted text-foreground-muted'
};

export default function FilesList({ initialFiles }: { initialFiles: UserFileListItem[] }) {
  const [files, setFiles] = useState<UserFileListItem[]>(initialFiles);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setFiles(await listFilesAction());
  }

  async function download(f: UserFileListItem) {
    setError(null);
    const res = await getFileDownloadUrlAction(f.id);
    if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    else setError(res.error || 'Kunde inte hämta filen.');
  }

  async function rename(f: UserFileListItem) {
    const name = window.prompt('Byt filnamn', f.filename);
    if (name == null) return;
    const res = await renameFileAction(f.id, name);
    if (res.error) setError(res.error);
    else await refresh();
  }

  async function remove(f: UserFileListItem) {
    if (!window.confirm(`Radera "${f.filename}"? Detta kan inte ångras.`)) return;
    const res = await deleteFileAction(f.id);
    if (res.error) setError(res.error);
    else await refresh();
  }

  function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    startTransition(async () => {
      const res = await uploadUserFileAction(fd);
      if (res.error) setError(res.error);
      else await refresh();
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  }

  return (
    <div className="mx-auto w-full max-w-[860px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-foreground-muted">
          Dina genererade och uppladdade filer — bara du ser dem.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          <Icon name="upload" size={14} />
          Ladda upp
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pptx,.xlsx,.docx,.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
          onChange={onUploadChange}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <div className="rounded-2xl border border-default bg-canvas-subtle px-6 py-16 text-center">
          <p className="font-heading text-[15px] font-semibold text-foreground">Inga filer än</p>
          <p className="mt-1 text-[13px] text-foreground-subtle">
            Be en agent i chatten att ta fram en rapport, eller ladda upp en fil.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => {
            const kind = f.doc_kind || 'other';
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-2xl border border-default bg-surface px-3 py-2.5 transition hover:border-strong"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${KIND_TONE[kind]}`}>
                  <Icon name="doc" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-foreground">{f.filename}</p>
                  <p className="text-[11.5px] text-foreground-subtle">
                    {KIND_LABEL[kind]}
                    {f.size_bytes ? ` · ${formatBytes(f.size_bytes)}` : ''}
                    {f.source === 'agent_generated' ? ' · genererad av AI' : ''}
                    {' · '}
                    {new Date(f.created).toLocaleDateString('sv-SE')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => download(f)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                  title="Ladda ned"
                  aria-label="Ladda ned"
                >
                  <Icon name="download" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => rename(f)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                  title="Byt namn"
                  aria-label="Byt namn"
                >
                  <Icon name="doc" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-movexum-pastell-orange hover:text-movexum-morkorange"
                  title="Radera"
                  aria-label="Radera"
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-center text-[11px] text-foreground-subtle">
        Genererade dokument: verifiera innan delning. Filerna lagras EU-suveränt (UpCloud) och är bara synliga för dig.
      </p>
    </div>
  );
}
