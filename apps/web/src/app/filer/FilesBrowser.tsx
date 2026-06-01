'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/proto/Icon';
import {
  FILE_TOPICS,
  FILE_TOPIC_LABELS,
  resolveFileTopic,
  DEFAULT_FILE_TOPIC,
  type FileTopic
} from '@platform/shared';
import {
  listFilesAction,
  getFileDownloadUrlAction,
  renameFileAction,
  deleteFileAction,
  uploadUserFileAction,
  categorizeAllFilesAction,
  setFileTopicAction,
  type UserFileListItem
} from '@/lib/actions/files';

type StartupOption = { id: string; name: string };
type View = 'amnen' | 'bolag';

const NO_COMPANY = '__none__';

const KIND_LABEL: Record<string, string> = {
  pptx: 'PowerPoint',
  xlsx: 'Excel',
  docx: 'Word',
  pdf: 'PDF',
  other: 'Fil'
};

function formatBytes(n?: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function topicIcon(topic: FileTopic): string {
  return FILE_TOPICS.find((t) => t.id === topic)?.icon ?? 'doc';
}

export default function FilesBrowser({
  initialFiles,
  startups
}: {
  initialFiles: UserFileListItem[];
  startups: StartupOption[];
}) {
  const [files, setFiles] = useState<UserFileListItem[]>(initialFiles);
  const [view, setView] = useState<View>('amnen');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [sortQueue, setSortQueue] = useState<UserFileListItem[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startupName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of startups) m.set(s.id, s.name);
    return m;
  }, [startups]);

  async function refresh() {
    setFiles(await listFilesAction());
  }

  // ── Gruppering ────────────────────────────────────────────────────────────
  const byTopic = useMemo(() => {
    const m = new Map<FileTopic, UserFileListItem[]>();
    for (const t of FILE_TOPICS) m.set(t.id, []);
    for (const f of files) {
      const topic = resolveFileTopic(f.topic);
      m.get(topic)!.push(f);
    }
    return m;
  }, [files]);

  const byCompany = useMemo(() => {
    const m = new Map<string, UserFileListItem[]>();
    for (const f of files) {
      const key = f.startup || NO_COMPANY;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(f);
    }
    return m;
  }, [files]);

  const reviewFiles = useMemo(
    () => files.filter((f) => f.topic_status === 'needs_review'),
    [files]
  );

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.size_bytes || 0), 0),
    [files]
  );

  const folderCount =
    view === 'amnen'
      ? FILE_TOPICS.filter((t) => (byTopic.get(t.id)?.length ?? 0) > 0).length
      : byCompany.size;

  const recent = useMemo(() => files.slice(0, 6), [files]);

  // ── Filåtgärder ─────────────────────────────────────────────────────────
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

  function sortWithAi() {
    setError(null);
    startTransition(async () => {
      const res = await categorizeAllFilesAction();
      if (res.error) setError(res.error);
      else await refresh();
    });
  }

  // ── Render-hjälpare ────────────────────────────────────────────────────────
  const selectedFiles: UserFileListItem[] | null = useMemo(() => {
    if (!openKey) return null;
    if (view === 'amnen') return byTopic.get(openKey as FileTopic) ?? [];
    return byCompany.get(openKey) ?? [];
  }, [openKey, view, byTopic, byCompany]);

  const selectedLabel =
    openKey == null
      ? ''
      : view === 'amnen'
        ? FILE_TOPIC_LABELS[openKey as FileTopic]
        : openKey === NO_COMPANY
          ? 'Utan bolag'
          : startupName.get(openKey) ?? 'Bolag';

  function switchView(next: View) {
    setView(next);
    setOpenKey(null);
  }

  return (
    <div className="space-y-6">
      {/* Topprad: beskrivning + åtgärder */}
      <div className="rounded-3xl border border-default bg-gradient-to-br from-canvas-subtle to-surface p-5 dark:from-brand/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-foreground-muted">
              Allt material samlat — sorterat på ämne eller bolag av AI, redo att dela och ladda
              ner.
            </p>
            <p className="mt-2 text-xs text-foreground-subtle">
              {files.length} filer · {folderCount} mappar · {formatBytes(totalBytes)} totalt
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={sortWithAi}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-default px-3 py-2 text-[13px] font-medium text-foreground transition hover:border-strong disabled:opacity-50"
            >
              <Icon name="sparkle" size={14} />
              Sortera med AI
            </button>
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
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
          {error}
        </div>
      )}

      {/* Granskningsbanner — AI osäker på var filer hör hemma */}
      {reviewFiles.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <div className="flex items-center gap-2.5 text-[13px] text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas-muted text-foreground-muted">
              <Icon name="alert" size={15} />
            </span>
            <span>
              AI:n är osäker på var{' '}
              <strong className="font-semibold">{reviewFiles.length}</strong>{' '}
              {reviewFiles.length === 1 ? 'fil' : 'filer'} hör hemma. Vill du bekräfta?
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSortQueue(reviewFiles)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover"
          >
            Granska
          </button>
        </div>
      )}

      {/* Vy-växel: Ämnen / Bolag */}
      <div className="inline-flex rounded-xl border border-default bg-surface p-1">
        {(['amnen', 'bolag'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => switchView(v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              view === v
                ? 'bg-brand text-brand-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            <Icon name={v === 'amnen' ? 'inbox' : 'briefcase'} size={14} />
            {v === 'amnen' ? 'Ämnen' : 'Bolag'}
          </button>
        ))}
      </div>

      {/* Mappgrid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view === 'amnen'
          ? FILE_TOPICS.map((t) => {
              const items = byTopic.get(t.id) ?? [];
              const bytes = items.reduce((s, f) => s + (f.size_bytes || 0), 0);
              return (
                <FolderCard
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  count={items.length}
                  bytes={bytes}
                  active={openKey === t.id}
                  onClick={() => setOpenKey(openKey === t.id ? null : t.id)}
                />
              );
            })
          : Array.from(byCompany.entries())
              .sort((a, b) => b[1].length - a[1].length)
              .map(([key, items]) => {
                const bytes = items.reduce((s, f) => s + (f.size_bytes || 0), 0);
                const label =
                  key === NO_COMPANY ? 'Utan bolag' : startupName.get(key) ?? 'Bolag';
                return (
                  <FolderCard
                    key={key}
                    icon={key === NO_COMPANY ? 'inbox' : 'briefcase'}
                    label={label}
                    count={items.length}
                    bytes={bytes}
                    active={openKey === key}
                    onClick={() => setOpenKey(openKey === key ? null : key)}
                  />
                );
              })}
      </div>

      {/* Vald mapp ELLER senaste filer */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-[15px] font-semibold text-foreground">
            {openKey ? selectedLabel : 'Senaste filer'}
          </h2>
          {openKey ? (
            <button
              type="button"
              onClick={() => setOpenKey(null)}
              className="text-[12.5px] text-foreground-subtle hover:text-foreground"
            >
              Visa senaste
            </button>
          ) : (
            <span className="text-[12.5px] text-foreground-subtle">i alla mappar</span>
          )}
        </div>

        {(openKey ? selectedFiles ?? [] : recent).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle px-6 py-12 text-center">
            <p className="font-heading text-[15px] font-semibold text-foreground">
              {files.length === 0 ? 'Inga filer än' : 'Inga filer i den här mappen'}
            </p>
            <p className="mt-1 text-[13px] text-foreground-subtle">
              {files.length === 0
                ? 'Be en agent i chatten att ta fram en rapport, eller ladda upp en fil.'
                : 'Ladda upp en fil eller låt AI:n sortera om.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(openKey ? selectedFiles ?? [] : recent).map((f) => (
              <FileRow
                key={f.id}
                file={f}
                companyName={f.startup ? startupName.get(f.startup) : undefined}
                onDownload={() => download(f)}
                onRename={() => rename(f)}
                onRemove={() => remove(f)}
                onMove={() => setSortQueue([f])}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[11px] text-foreground-subtle">
        Ämnen sätts av AI (Mistral, EU-suveränt) — verifiera innan delning. Filerna lagras
        EU-suveränt och är bara synliga för dig.
      </p>

      {sortQueue && (
        <FileSortDialog
          queue={sortQueue}
          startups={startups}
          onClose={() => setSortQueue(null)}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Mappkort ──────────────────────────────────────────────────────────────
function FolderCard({
  icon,
  label,
  count,
  bytes,
  active,
  onClick
}: {
  icon: string;
  label: string;
  count: number;
  bytes: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border bg-surface p-4 text-left transition ${
        active ? 'border-brand ring-1 ring-brand/30' : 'border-default hover:border-strong'
      }`}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-canvas-muted text-foreground-muted">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-foreground">{label}</span>
        <span className="block text-[11.5px] text-foreground-subtle">
          {count} {count === 1 ? 'fil' : 'filer'}
          {bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
        </span>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}

// ── Filrad ──────────────────────────────────────────────────────────────────
function FileRow({
  file,
  companyName,
  onDownload,
  onRename,
  onRemove,
  onMove
}: {
  file: UserFileListItem;
  companyName?: string;
  onDownload: () => void;
  onRename: () => void;
  onRemove: () => void;
  onMove: () => void;
}) {
  const kind = file.doc_kind || 'other';
  const topic = resolveFileTopic(file.topic);
  const aiSorted = file.topic_status === 'auto';
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-default bg-surface px-3 py-2.5 transition hover:border-strong">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-canvas-muted text-foreground-muted">
        <Icon name={topicIcon(topic)} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-foreground">{file.filename}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-foreground-subtle">
          <span>{KIND_LABEL[kind]}</span>
          {file.size_bytes ? <span>· {formatBytes(file.size_bytes)}</span> : null}
          <span>· {FILE_TOPIC_LABELS[topic]}</span>
          {companyName ? <span>· {companyName}</span> : null}
          {aiSorted ? (
            <span className="inline-flex items-center gap-0.5 text-foreground-subtle">
              · <Icon name="sparkle" size={10} /> AI
            </span>
          ) : null}
          {file.source === 'agent_generated' ? <span>· genererad</span> : null}
        </p>
      </div>
      <RowButton title="Byt ämne" icon="filter" onClick={onMove} />
      <RowButton title="Ladda ned" icon="download" onClick={onDownload} />
      <RowButton title="Byt namn" icon="pencil" onClick={onRename} />
      <RowButton title="Radera" icon="trash" onClick={onRemove} danger />
    </li>
  );
}

function RowButton({
  title,
  icon,
  onClick,
  danger
}: {
  title: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition ${
        danger
          ? 'hover:bg-movexum-pastell-orange hover:text-movexum-morkorange'
          : 'hover:bg-canvas-muted hover:text-foreground'
      }`}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

// ── Osäkerhetsdialog / flytta-dialog (människa-i-loopen) ─────────────────────
function FileSortDialog({
  queue,
  startups,
  onClose,
  onSaved
}: {
  queue: UserFileListItem[];
  startups: StartupOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const file = queue[index];
  const [topic, setTopic] = useState<FileTopic>(resolveFileTopic(file?.topic));
  const [company, setCompany] = useState<string>(file?.startup || '');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function loadFile(i: number) {
    const f = queue[i];
    setIndex(i);
    setTopic(resolveFileTopic(f?.topic));
    setCompany(f?.startup || '');
    setError(null);
  }

  function save() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const res = await setFileTopicAction(file.id, topic, company || null);
      if (res.error) {
        setError(res.error);
        return;
      }
      await onSaved();
      if (index + 1 < queue.length) loadFile(index + 1);
      else onClose();
    });
  }

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-default bg-surface p-6 shadow-movexum-svart/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground">
              Var hör filen hemma?
            </h3>
            <p className="mt-0.5 text-[12.5px] text-foreground-subtle">
              {queue.length > 1 ? `Fil ${index + 1} av ${queue.length} · ` : ''}
              {file.topic_status === 'needs_review'
                ? 'AI:n var osäker — välj ämne.'
                : 'Flytta filen till ett annat ämne.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
            aria-label="Stäng"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <p className="mb-4 truncate rounded-xl bg-canvas-subtle px-3 py-2 text-[13px] font-medium text-foreground">
          {file.filename}
        </p>

        <label className="mb-1 block text-[12px] font-medium text-foreground-muted">Ämne</label>
        <select
          value={topic}
          onChange={(e) => setTopic(e.target.value as FileTopic)}
          className="mb-4 w-full rounded-xl border border-default bg-surface px-3 py-2 text-[13.5px] text-foreground focus:border-strong focus:outline-none"
        >
          {FILE_TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[12px] font-medium text-foreground-muted">
          Bolag (valfritt)
        </label>
        <select
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="mb-4 w-full rounded-xl border border-default bg-surface px-3 py-2 text-[13.5px] text-foreground focus:border-strong focus:outline-none"
        >
          <option value="">Inget bolag</option>
          {startups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {error && (
          <div className="mb-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-default px-3 py-2 text-[13px] font-medium text-foreground transition hover:border-strong"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
          >
            <Icon name="check" size={14} />
            {index + 1 < queue.length ? 'Spara & nästa' : 'Spara'}
          </button>
        </div>

        {DEFAULT_FILE_TOPIC === topic && (
          <p className="mt-3 text-[11px] text-foreground-subtle">
            Tips: välj ett mer specifikt ämne så hamnar filen i rätt mapp.
          </p>
        )}
      </div>
    </div>
  );
}
