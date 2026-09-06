'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import DashboardChat, {
  type DashboardAgent,
  type DashboardConnector,
  type DashboardActivity,
  type LiveStep,
  type QueuedItem,
  type UiMessage
} from '@/components/DashboardChat';
import { Icon } from '@/components/proto/Icon';
import MeetingMode, { type MeetingInitial } from '@/components/meeting/MeetingMode';
import type { ChatAttachment } from '@/lib/actions/chat';
import type { GeneratedFileRef, MeetingRequestRef, ToolRunMessage } from '@platform/shared';
import {
  listResumableMeetingsAction,
  type ResumableMeeting
} from '@/lib/actions/meetings';
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
import { actionErrorMessage } from '@/lib/action-error';
import { isAllowedModel } from '@/lib/ai/models';
import type { Role } from '@platform/shared';

interface Props {
  greeting: string;
  agents: DashboardAgent[];
  connectors: DashboardConnector[];
  activities: DashboardActivity[];
  /** Inloggad användares roller — hjälp-guiden är rollspecifik (§ 33.3). */
  userRoles: Role[];
  initialThreads: ThreadListResult;
}

type SubmitOpts = { includeWebContext: boolean; attachments: ChatAttachment[]; model?: string };

// Modellvalet (§ 9.9) sparas per webbläsare — bekvämlighet, ingen datakälla
// (servern validerar alltid mot registret i lib/ai/models.ts).
const MODEL_STORAGE_KEY = 'movexum-chat-model';

function readStoredModel(): string {
  try {
    const v = window.localStorage.getItem(MODEL_STORAGE_KEY) || '';
    return isAllowedModel(v) ? v : '';
  } catch {
    return '';
  }
}

// Ett köat meddelande med all info som behövs för att köra det senare.
type QueuedTurn = { id: string; text: string; opts: SubmitOpts; displayText: string };

function toUiMessages(messages: ToolRunMessage[]): UiMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      generated_files: m.generated_files,
      visuals: m.visuals,
      steps: m.steps,
      approval_request: m.approval_request,
      meeting_request: m.meeting_request,
      model: m.role === 'assistant' ? m.model : undefined,
      // Turens tokens (in + ut, per-turn-metadata § 9.9) → inline miljöchip
      // under varje assistant-svar.
      tokens:
        m.role === 'assistant'
          ? (Number(m.tokens_in) || 0) + (Number(m.tokens_out) || 0)
          : undefined
    }));
}

export default function ChattWorkspace({ greeting, agents, connectors, activities, userRoles, initialThreads }: Props) {
  const [threads, setThreads] = useState<ThreadListResult>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [activeAgent, setActiveAgent] = useState<DashboardAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  // Svaret medan det strömmas in token-för-token (löpande utskrift).
  const [liveText, setLiveText] = useState('');
  // Valt modell-id ('' = Auto). Läses från localStorage EFTER mount så servern
  // och klienten renderar samma initialvärde vid hydreringen.
  const [model, setModel] = useState('');
  const [rightOpen, setRightOpen] = useState(true);
  // Mötesläget (§ 34): null = stängt; objektet bär ev. förifyllnad/återupptag.
  const [meetingPanel, setMeetingPanel] = useState<MeetingInitial | null>(null);
  const [resumableMeetings, setResumableMeetings] = useState<ResumableMeeting[]>([]);
  // Köade meddelanden (skrivna medan en turn körs). `queueRef` är sanningen
  // (synkron åtkomst i körnings-callbacks); `queued` speglar den för rendering.
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<QueuedTurn[]>([]);
  // Synkrona "upptagen"-flaggor så submit/drain inte tävlar med React-state.
  const streamingRef = useRef(false);

  useEffect(() => {
    setModel(readStoredModel());
  }, []);

  function changeModel(next: string) {
    const clean = isAllowedModel(next) ? next : '';
    setModel(clean);
    try {
      if (clean) window.localStorage.setItem(MODEL_STORAGE_KEY, clean);
      else window.localStorage.removeItem(MODEL_STORAGE_KEY);
    } catch {
      /* privat läge / blockerad lagring — valet gäller ändå för sessionen */
    }
  }

  function publishQueue() {
    setQueued(queueRef.current.map((q) => ({ id: q.id, content: q.displayText })));
  }

  // Kör nästa köade meddelande om inget redan körs.
  const runNextRef = useRef<() => void>(() => {});
  function runNext() {
    if (streamingRef.current) return;
    const next = queueRef.current[0];
    if (!next) return;
    queueRef.current = queueRef.current.slice(1);
    publishQueue();
    runTurn(next);
  }
  runNextRef.current = runNext;

  // Kastar ALDRIG (anropas fire-and-forget från många ställen): trådlistan är
  // dekorativ — vid stale deploy/nätverksglapp behåller vi den lista vi har.
  const refreshThreads = useCallback(async () => {
    try {
      const next = await listThreadsAction();
      setThreads(next);
    } catch (err) {
      console.error('[ChattWorkspace] kunde inte uppdatera trådlistan', err);
    }
  }, []);

  // Oavslutade möten (kraschad flik / ej sparad granskning) → återuppta-banner.
  // Kastar aldrig (körs i useEffect utan felhantering hos anroparen).
  const refreshResumableMeetings = useCallback(async () => {
    try {
      const res = await listResumableMeetingsAction();
      setResumableMeetings(res.meetings);
    } catch (err) {
      console.error('[ChattWorkspace] kunde inte lista oavslutade möten', err);
    }
  }, []);

  useEffect(() => {
    void refreshResumableMeetings();
  }, [refreshResumableMeetings]);

  function closeMeetingPanel() {
    setMeetingPanel(null);
    void refreshResumableMeetings();
  }

  // "Föreslå uppgifter i chatten" efter ett sparat möte: skickas som en vanlig
  // user-tur (mänskligt klick — samma mönster som Godkänn-knappen, § 33).
  function sendMeetingPromptToChat(prompt: string) {
    submit(prompt, { includeWebContext: false, attachments: [], model });
  }

  // Laddar in de persisterade trådmeddelandena (inkl. per-turn-tokens) i UI:t.
  const applyThreadMessages = useCallback((raw: ToolRunMessage[]) => {
    setMessages(toUiMessages(raw));
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function clearQueue() {
    queueRef.current = [];
    publishQueue();
  }

  function cancelQueued(id: string) {
    queueRef.current = queueRef.current.filter((q) => q.id !== id);
    publishQueue();
  }

  function newChat() {
    clearQueue();
    setActiveThreadId(null);
    setMessages([]);
    setActiveAgent(null);
    setError(null);
  }

  async function openThread(id: string) {
    setError(null);
    setMenuFor(null);
    clearQueue();
    try {
      const res = await getThreadMessagesAction(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setActiveThreadId(id);
      applyThreadMessages(res.messages || []);
      setActiveAgent(res.agent ? agents.find((a) => a.id === res.agent) || null : null);
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte öppna chatten — försök igen.'));
    }
  }

  function applyStep(ev: { phase: 'start' | 'end'; id: string; label: string; ok?: boolean }) {
    // Ett verktygssteg startar → ev. text som strömmats innan dess var en
    // inledning före verktygsanropet, inte slutsvaret. Nolla den löpande
    // texten så bara det riktiga svaret (som strömmas EFTER stegen) blir kvar.
    if (ev.phase === 'start') setLiveText('');
    setLiveSteps((prev) => {
      if (ev.phase === 'start') {
        if (prev.some((s) => s.id === ev.id)) return prev;
        return [...prev, { id: ev.id, label: ev.label, running: true }];
      }
      return prev.map((s) => (s.id === ev.id ? { ...s, running: false, ok: ev.ok } : s));
    });
  }

  // Icke-streamande fallback (server-action) om streaming inte är tillgänglig.
  async function fallbackTurn(threadId: string, text: string, opts: SubmitOpts) {
    const res = await sendThreadMessageAction(threadId, text, {
      includeWebContext: opts.includeWebContext,
      attachments: opts.attachments,
      model: opts.model || undefined
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.messages) applyThreadMessages(res.messages);
    await refreshThreads();
  }

  async function runStreamingTurn(text: string, opts: SubmitOpts) {
    streamingRef.current = true;
    setStreaming(true);
    setLiveSteps([]);
    setLiveText('');
    try {
      // Ingen server action FÖRE skicket: saknas tråd skapar streaming-
      // endpointen den (och skickar id:t som `thread`-event). Server
      // action-id:n byts vid deploy — en stale flik fick förut
      // UnrecognizedActionError redan på createThreadAction och kunde inte
      // skicka alls; route-handler-fetchen påverkas inte av deployer.
      let threadId = activeThreadId;

      let res: Response;
      try {
        res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            threadId: threadId ?? undefined,
            agentId: activeAgent?.id,
            text,
            includeWebContext: opts.includeWebContext,
            attachments: opts.attachments,
            model: opts.model || undefined
          })
        });
      } catch {
        // Nätverks-/uppkopplingsfel → degradera till server-action.
        if (!threadId) {
          const created = await createThreadAction(activeAgent?.id);
          if (created.error || !created.threadId) {
            setError(created.error || 'Kunde inte skapa tråd.');
            return;
          }
          threadId = created.threadId;
          setActiveThreadId(threadId);
        }
        await fallbackTurn(threadId, text, opts);
        return;
      }

      if (!res.ok || !res.body) {
        if (res.status >= 500 && threadId) {
          await fallbackTurn(threadId, text, opts);
        } else {
          let msg = 'Kunde inte hämta svar just nu — försök igen.';
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* behåll default */
          }
          setError(msg);
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let gotFinal = false;
      let gotError = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (ev.type === 'thread') {
            // Endpointen skapade tråden åt oss (ny chatt) — ta emot id:t så
            // efterföljande turer hamnar i samma tråd.
            if (typeof ev.threadId === 'string' && ev.threadId) {
              threadId = ev.threadId;
              setActiveThreadId(ev.threadId);
            }
          } else if (ev.type === 'step') {
            applyStep(ev as unknown as { phase: 'start' | 'end'; id: string; label: string; ok?: boolean });
          } else if (ev.type === 'token') {
            const delta = ev.delta;
            if (typeof delta === 'string' && delta) setLiveText((prev) => prev + delta);
          } else if (ev.type === 'final') {
            gotFinal = true;
            // Persisterade meddelandet ersätter den live-strömmade texten —
            // nolla liveText så svaret inte visas dubbelt en kort stund.
            setLiveText('');
            if (Array.isArray(ev.messages)) applyThreadMessages(ev.messages as ToolRunMessage[]);
          } else if (ev.type === 'error') {
            gotError = true;
            setError(typeof ev.error === 'string' ? ev.error : 'Kunde inte hämta svar just nu — försök igen.');
          }
        }
      }

      // Strömmen stängdes utan ett slutgiltigt meddelande (t.ex. proxy bröt
      // anslutningen) — turen kan ändå ha sparats server-side, så ladda om.
      if (!gotFinal && !gotError && threadId) {
        const msgs = await getThreadMessagesAction(threadId).catch(() => null);
        if (msgs?.messages) applyThreadMessages(msgs.messages);
      }
      await refreshThreads();
    } catch (err) {
      // Utan denna catch blev ett kastat action-fel (t.ex. stale deploy i
      // fallbackTurn) en obehandlad rejection: inget felmeddelande, chatten
      // såg bara ut att "stanna upp". Flaggorna städas alltid i finally.
      console.error('[ChattWorkspace] chatturen misslyckades', err);
      setError(actionErrorMessage(err, 'Kunde inte hämta svar just nu — försök igen.'));
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      setLiveSteps([]);
      setLiveText('');
      // Turen klar → kör nästa köade meddelande (löpande feedback).
      runNextRef.current();
    }
  }

  // Visar användarmeddelandet i transkriptet och kör turen (streaming).
  function runTurn(item: QueuedTurn) {
    setMessages((prev) => [...prev, { role: 'user', content: item.displayText }]);
    void runStreamingTurn(item.text, item.opts);
  }

  function submit(text: string, opts: SubmitOpts) {
    setError(null);
    const displayText =
      text || (opts.attachments.length === 1 ? '(bilaga skickad)' : '(bilagor skickade)');
    const item: QueuedTurn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      opts,
      displayText
    };
    // Upptagen (en turn kör eller kön är icke-tom) → köa. Annars kör direkt.
    const busy = streamingRef.current || queueRef.current.length > 0;
    if (busy) {
      queueRef.current = [...queueRef.current, item];
      publishQueue();
      return;
    }
    runTurn(item);
  }

  // Svar på agentens godkännandefråga (§ 33): skickas som en vanlig user-tur
  // ("Godkänn"/"Avbryt") så beslutet syns i transkriptet och persisteras i
  // tråden — agenten utför (eller avstår) i nästa svar.
  function onApproval(approved: boolean) {
    submit(approved ? 'Godkänn' : 'Avbryt', {
      includeWebContext: false,
      attachments: [],
      model
    });
  }

  async function onDownload(file: GeneratedFileRef) {
    try {
      const res = await getFileDownloadUrlAction(file.user_file_id);
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        setError(res.error || 'Kunde inte hämta filen.');
      }
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte hämta filen — försök igen.'));
    }
  }

  async function doRename(item: ThreadListItem) {
    setMenuFor(null);
    const title = window.prompt('Byt namn på chatten', item.title);
    if (title == null) return;
    try {
      await renameThreadAction(item.id, title);
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte byta namn på chatten.'));
    }
    await refreshThreads();
  }

  async function doPin(item: ThreadListItem) {
    setMenuFor(null);
    try {
      await pinThreadAction(item.id, !item.pinned);
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte fästa chatten.'));
    }
    await refreshThreads();
  }

  async function doArchive(item: ThreadListItem) {
    setMenuFor(null);
    try {
      await archiveThreadAction(item.id, item.status !== 'archived');
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte arkivera chatten.'));
    }
    await refreshThreads();
  }

  async function doDelete(item: ThreadListItem) {
    setMenuFor(null);
    if (!window.confirm(`Radera chatten "${item.title}"? Den tas bort från listan (mjuk radering).`)) {
      return;
    }
    try {
      await deleteThreadAction(item.id);
      if (activeThreadId === item.id) newChat();
    } catch (err) {
      setError(actionErrorMessage(err, 'Kunde inte radera chatten.'));
    }
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
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground"
          aria-label="Fler val (byt namn, fäst, arkivera, radera)"
          aria-haspopup="menu"
          aria-expanded={menuFor === item.id}
        >
          <Icon name="more" size={16} fill="currentColor" />
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
      {meetingPanel && (
        <MeetingMode
          initial={meetingPanel}
          onClose={closeMeetingPanel}
          onSendToChat={sendMeetingPromptToChat}
        />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {resumableMeetings.length > 0 && !meetingPanel && (
          <div className="flex items-center justify-between gap-3 border-b border-default bg-movexum-pastell-gul px-4 py-2">
            <p className="min-w-0 truncate text-[12.5px] text-movexum-morkgul">
              <span className="font-semibold">Oavslutat möte:</span>{' '}
              {resumableMeetings[0].title} ({resumableMeetings[0].segmentCount} transkriberade
              segment). Osparade möten raderas efter 7 dagar.
            </p>
            <button
              type="button"
              onClick={() => setMeetingPanel({ resumeMeetingId: resumableMeetings[0].id })}
              className="shrink-0 rounded-lg bg-movexum-morkgul px-3 py-1 text-[12px] font-medium text-movexum-vit transition hover:opacity-90"
            >
              Återuppta granskningen
            </button>
          </div>
        )}
        <DashboardChat
          greeting={greeting}
          agents={agents}
          connectors={connectors}
          activities={activities}
          userRoles={userRoles}
          messages={messages}
          isPending={streaming}
          error={error}
          activeAgent={activeAgent}
          model={model}
          onModelChange={changeModel}
          liveSteps={liveSteps}
          liveText={liveText}
          queued={queued}
          resetSignal={activeThreadId ?? 'new'}
          onPickAgent={setActiveAgent}
          onReset={newChat}
          onSubmit={(text, opts) => submit(text, { ...opts, model })}
          onDownload={onDownload}
          onCancelQueued={cancelQueued}
          onApproval={onApproval}
          onOpenMeeting={() => setMeetingPanel({})}
          onStartMeeting={(req: MeetingRequestRef) =>
            setMeetingPanel({
              startupId: req.startup_id,
              startupName: req.startup_name,
              title: req.title
            })
          }
        />
        {!rightOpen && (
          <button
            type="button"
            onClick={() => setRightOpen(true)}
            className="absolute right-3 top-3 z-10 hidden h-8 w-8 items-center justify-center rounded-lg border border-default bg-surface text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground md:flex"
            title="Visa trådar"
            aria-label="Visa trådar"
          >
            <Icon name="panel-right" size={14} />
          </button>
        )}
      </div>

      {rightOpen && (
        <aside className="hidden w-64 shrink-0 flex-col border-l border-default bg-canvas-subtle md:flex">
          <div className="flex items-center gap-2 p-3">
            <button
              type="button"
              onClick={newChat}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-default bg-surface px-3 py-2 text-[13px] font-medium text-foreground transition hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/5"
            >
              <Icon name="plus" size={14} />
              Ny chatt
            </button>
            <button
              type="button"
              onClick={() => setRightOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
              title="Stäng"
              aria-label="Stäng trådar"
            >
              <Icon name="x" size={13} />
            </button>
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
      )}
    </div>
  );
}
