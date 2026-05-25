'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import DashboardChat, {
  type DashboardAgent,
  type DashboardConnector,
  type UiMessage
} from '@/components/DashboardChat';
import { Icon } from '@/components/proto/Icon';
import type { ChatAttachment } from '@/lib/actions/chat';
import type { GeneratedFileRef, ToolRunMessage } from '@platform/shared';
import {
  createThreadAction,
  listThreadsAction,
  getThreadMessagesAction,
  renameThreadAction,
  pinThreadAction,
  archiveThreadAction,
  deleteThreadAction,
  sendThreadMessageAction,
  type ThreadListResult,
  type ThreadListItem
} from '@/lib/actions/chat-threads';
import { getFileDownloadUrlAction } from '@/lib/actions/files';
import {
  startDeepJobAction,
  getDeepJobStatusAction
} from '@/lib/actions/deep-jobs';
import type { DeepJobStatus } from '@platform/shared';

interface Props {
  greeting: string;
  agents: DashboardAgent[];
  connectors: DashboardConnector[];
  initialThreads: ThreadListResult;
}

function toUiMessages(messages: ToolRunMessage[]): UiMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      generated_files: m.generated_files
    }));
}

export default function ChattWorkspace({ greeting, agents, connectors, initialThreads }: Props) {
  const [threads, setThreads] = useState<ThreadListResult>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [activeAgent, setActiveAgent] = useState<DashboardAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deepJob, setDeepJob] = useState<{ id: string; threadId: string; status: DeepJobStatus; progress: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const deepRunning =
    !!deepJob && !['succeeded', 'failed', 'cancelled'].includes(deepJob.status);

  const refreshThreads = useCallback(async () => {
    const next = await listThreadsAction();
    setThreads(next);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Pollar ett pågående djupt jobb och laddar in utkastet när det är klart.
  useEffect(() => {
    if (!deepJob || !deepRunning) return;
    const timer = setInterval(async () => {
      const res = await getDeepJobStatusAction(deepJob.id);
      if (res.error || !res.status) return;
      const status = res.status;
      setDeepJob((cur) => (cur ? { ...cur, status, progress: res.progress ?? cur.progress } : cur));
      if (['succeeded', 'failed', 'cancelled'].includes(status)) {
        const msgs = await getThreadMessagesAction(deepJob.threadId);
        if (msgs.messages) setMessages(toUiMessages(msgs.messages));
        await refreshThreads();
        if (status === 'failed') setError(res.jobError || 'Det djupa jobbet misslyckades.');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [deepJob, deepRunning, refreshThreads]);

  async function startDeep() {
    const instruction = window.prompt(
      'Vad ska det djupa jobbet göra? Det planerar, hämtar data i flera steg och sammanställer ett utkast (ev. ett dokument) i tråden.'
    );
    if (!instruction || !instruction.trim()) return;
    setError(null);
    let threadId = activeThreadId;
    if (!threadId) {
      const created = await createThreadAction(activeAgent?.id);
      if (created.error || !created.threadId) {
        setError(created.error || 'Kunde inte skapa tråd.');
        return;
      }
      threadId = created.threadId;
      setActiveThreadId(threadId);
    }
    const res = await startDeepJobAction(threadId, instruction);
    if (res.error || !res.jobId) {
      setError(res.error || 'Kunde inte starta jobbet.');
      return;
    }
    setDeepJob({ id: res.jobId, threadId, status: 'queued', progress: 0 });
    const msgs = await getThreadMessagesAction(threadId);
    if (msgs.messages) setMessages(toUiMessages(msgs.messages));
    await refreshThreads();
  }

  function newChat() {
    setActiveThreadId(null);
    setMessages([]);
    setActiveAgent(null);
    setError(null);
  }

  async function openThread(id: string) {
    setError(null);
    setMenuFor(null);
    const res = await getThreadMessagesAction(id);
    if (res.error) {
      setError(res.error);
      return;
    }
    setActiveThreadId(id);
    setMessages(toUiMessages(res.messages || []));
    setActiveAgent(res.agent ? agents.find((a) => a.id === res.agent) || null : null);
  }

  function submit(text: string, opts: { includeWebContext: boolean; attachments: ChatAttachment[] }) {
    setError(null);
    const displayText =
      text || (opts.attachments.length === 1 ? '(bilaga skickad)' : '(bilagor skickade)');
    setMessages((prev) => [...prev, { role: 'user', content: displayText }]);

    startTransition(async () => {
      let threadId = activeThreadId;
      if (!threadId) {
        const created = await createThreadAction(activeAgent?.id);
        if (created.error || !created.threadId) {
          setError(created.error || 'Kunde inte skapa tråd.');
          return;
        }
        threadId = created.threadId;
        setActiveThreadId(threadId);
      }
      const res = await sendThreadMessageAction(threadId, text, {
        includeWebContext: opts.includeWebContext,
        attachments: opts.attachments
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.messages) setMessages(toUiMessages(res.messages));
      await refreshThreads();
    });
  }

  async function onDownload(file: GeneratedFileRef) {
    const res = await getFileDownloadUrlAction(file.user_file_id);
    if (res.url) {
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } else {
      setError(res.error || 'Kunde inte hämta filen.');
    }
  }

  async function doRename(item: ThreadListItem) {
    setMenuFor(null);
    const title = window.prompt('Byt namn på chatten', item.title);
    if (title == null) return;
    await renameThreadAction(item.id, title);
    await refreshThreads();
  }

  async function doPin(item: ThreadListItem) {
    setMenuFor(null);
    await pinThreadAction(item.id, !item.pinned);
    await refreshThreads();
  }

  async function doArchive(item: ThreadListItem) {
    setMenuFor(null);
    await archiveThreadAction(item.id, item.status !== 'archived');
    await refreshThreads();
  }

  async function doDelete(item: ThreadListItem) {
    setMenuFor(null);
    if (!window.confirm(`Radera chatten "${item.title}"? Den tas bort från listan (mjuk radering).`)) {
      return;
    }
    await deleteThreadAction(item.id);
    if (activeThreadId === item.id) newChat();
    await refreshThreads();
  }

  function ThreadRow({ item }: { item: ThreadListItem }) {
    const selected = item.id === activeThreadId;
    return (
      <div
        className={`group relative flex items-center gap-1 rounded-xl px-2 py-1.5 text-[13px] transition ${
          selected ? 'bg-canvas-muted text-foreground' : 'text-foreground-muted hover:bg-canvas-subtle'
        }`}
      >
        <button
          type="button"
          onClick={() => openThread(item.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {item.pinned && <Icon name="star" size={11} />}
          <span className="truncate">{item.title}</span>
        </button>
        <button
          type="button"
          onClick={() => setMenuFor((cur) => (cur === item.id ? null : item.id))}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition hover:bg-canvas-muted hover:text-foreground group-hover:opacity-100"
          aria-label="Fler val"
        >
          <Icon name="more" size={14} />
        </button>
        {menuFor === item.id && (
          <div
            ref={menuRef}
            className="absolute right-1 top-8 z-10 w-40 overflow-hidden rounded-xl border border-default bg-surface py-1 text-[13px] shadow-md shadow-movexum-svart/10"
          >
            <button type="button" onClick={() => doRename(item)} className="flex w-full items-center gap-2 px-3 py-1.5 text-foreground transition hover:bg-canvas-subtle">
              <Icon name="doc" size={12} /> Byt namn
            </button>
            <button type="button" onClick={() => doPin(item)} className="flex w-full items-center gap-2 px-3 py-1.5 text-foreground transition hover:bg-canvas-subtle">
              <Icon name="star" size={12} /> {item.pinned ? 'Ta bort fäst' : 'Fäst'}
            </button>
            <button type="button" onClick={() => doArchive(item)} className="flex w-full items-center gap-2 px-3 py-1.5 text-foreground transition hover:bg-canvas-subtle">
              <Icon name="inbox" size={12} /> {item.status === 'archived' ? 'Återställ' : 'Arkivera'}
            </button>
            <button type="button" onClick={() => doDelete(item)} className="flex w-full items-center gap-2 px-3 py-1.5 text-movexum-morkorange transition hover:bg-movexum-pastell-orange">
              <Icon name="close" size={12} /> Radera
            </button>
          </div>
        )}
      </div>
    );
  }

  function Section({ label, items }: { label: string; items: ThreadListItem[] }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-3">
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          {label}
        </p>
        <div className="flex flex-col gap-0.5">
          {items.map((i) => (
            <ThreadRow key={i.id} item={i} />
          ))}
        </div>
      </div>
    );
  }

  const hasThreads =
    threads.pinned.length + threads.active.length + threads.archived.length > 0;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-default bg-canvas-subtle md:flex">
        <div className="flex flex-col gap-2 p-3">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-default bg-surface px-3 py-2 text-[13px] font-medium text-foreground transition hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/5"
          >
            <Icon name="plus" size={14} />
            Ny chatt
          </button>
          <button
            type="button"
            onClick={startDeep}
            disabled={deepRunning}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-movexum-pastell-lila px-3 py-2 text-[13px] font-medium text-movexum-morklila transition hover:brightness-95 disabled:opacity-50"
            title="Planerar, hämtar data i flera steg och sammanställer ett utkast"
          >
            <Icon name="sparkle" size={14} />
            {deepRunning ? `Djupt jobb… ${deepJob?.progress ?? 0}%` : 'Djupt jobb'}
          </button>
          {deepRunning && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-canvas-muted">
              <div
                className="h-full bg-movexum-lila transition-all"
                style={{ width: `${deepJob?.progress ?? 0}%` }}
              />
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {!hasThreads ? (
            <p className="px-2 py-6 text-center text-[12px] text-foreground-subtle">
              Inga sparade chattar än. Dina konversationer hamnar här.
            </p>
          ) : (
            <>
              <Section label="Fäst" items={threads.pinned} />
              <Section label="Senaste" items={threads.active} />
              <Section label="Arkiverade" items={threads.archived} />
            </>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <DashboardChat
          greeting={greeting}
          agents={agents}
          connectors={connectors}
          messages={messages}
          isPending={isPending || deepRunning}
          error={error}
          activeAgent={activeAgent}
          onPickAgent={setActiveAgent}
          onReset={newChat}
          onSubmit={submit}
          onDownload={onDownload}
        />
      </div>
    </div>
  );
}
