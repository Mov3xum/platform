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
import {
  startDeepJobAction,
  getDeepJobStatusAction
} from '@/lib/actions/deep-jobs';
import {
  actionErrorMessage,
  isStaleDeploymentError,
  STALE_DEPLOYMENT_MESSAGE
} from '@/lib/action-error';
import type { DeepJobStatus, Role } from '@platform/shared';

interface Props {
  greeting: string;
  agents: DashboardAgent[];
  connectors: DashboardConnector[];
  activities: DashboardActivity[];
  /** Inloggad användares roller — hjälp-guiden är rollspecifik (§ 33.3). */
  userRoles: Role[];
  initialThreads: ThreadListResult;
}

type SubmitOpts = { includeWebContext: boolean; attachments: ChatAttachment[]; deepJob: boolean };

// Ett köat meddelande med all info som behövs för att köra det senare.
type QueuedTurn = { id: string; text: string; opts: SubmitOpts; displayText: string };

// Körtillstånd PER TRÅD — flera trådar kan ha varsin pågående turn samtidigt.
// Turer i olika trådar är oberoende server-side (varje turn laddar och sparar
// sin egen tråd-rad), så parallellitet är rent klient-tillstånd. Inom EN tråd
// gäller fortsatt kö-semantiken (en turn i taget, ordningen bevaras).
interface ConvState {
  messages: UiMessage[];
  /** Meddelandena är inlästa (skapad denna session eller hämtade från servern). */
  loaded: boolean;
  agentId: string | null;
  /** En turn förbereds (tråd skapas / djupjobb registreras) — räknas som upptagen. */
  starting: boolean;
  streaming: boolean;
  liveSteps: LiveStep[];
  liveText: string;
  deepJob: { id: string; status: DeepJobStatus; progress: number } | null;
  queue: QueuedTurn[];
  error: string | null;
  /** En turn blev klar medan tråden inte var öppen → grön prick tills den öppnas. */
  unread: boolean;
}

// Nyckel för den ännu inte sparade "Ny chatt"-konversationen. Migreras till
// det riktiga tråd-id:t när tråden skapats (kö + meddelanden följer med).
const DRAFT_KEY = '__draft__';

const DEEP_TERMINAL: DeepJobStatus[] = ['succeeded', 'failed', 'cancelled'];

function emptyConv(): ConvState {
  return {
    messages: [],
    loaded: false,
    agentId: null,
    starting: false,
    streaming: false,
    liveSteps: [],
    liveText: '',
    deepJob: null,
    queue: [],
    error: null,
    unread: false
  };
}

function isDeepRunning(c?: ConvState | null): boolean {
  return !!c?.deepJob && !DEEP_TERMINAL.includes(c.deepJob.status);
}

/** Tråden kör (eller har köat) något — nya meddelanden i den köas. */
function isBusy(c?: ConvState | null): boolean {
  return !!c && (c.starting || c.streaming || isDeepRunning(c) || c.queue.length > 0);
}

// ── Statusprickar per tråd (som Claude Code) ────────────────────────────────
// blå (pulserande) = agenten arbetar · gul = väntar på dig · orange = fel ·
// grön = klart, oläst svar. Movexum-paletten (§ 2.3) — aldrig röd.
type ThreadStatus = 'working' | 'action' | 'error' | 'done';

function statusFor(c?: ConvState): ThreadStatus | null {
  if (!c) return null;
  if (c.starting || c.streaming || isDeepRunning(c) || c.queue.length > 0) return 'working';
  if (c.error) return 'error';
  const last = c.messages[c.messages.length - 1];
  if (last?.role === 'assistant' && (last.approval_request || last.meeting_request)) {
    return 'action';
  }
  if (c.unread) return 'done';
  return null;
}

const STATUS_DOT: Record<ThreadStatus, { cls: string; label: string }> = {
  working: { cls: 'bg-movexum-bla animate-pulse', label: 'Agenten arbetar' },
  action: { cls: 'bg-movexum-gul', label: 'Väntar på dig — godkännande eller möte' },
  error: { cls: 'bg-movexum-orange', label: 'Något gick fel — öppna chatten' },
  done: { cls: 'bg-movexum-gron', label: 'Klart — nytt svar att läsa' }
};

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
  // Alla konversationers körtillstånd, nycklat på tråd-id (eller DRAFT_KEY).
  // `convsRef` är sanningen (synkron åtkomst i körnings-callbacks som löper
  // parallellt); state speglar den för rendering.
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const [activeAgent, setActiveAgent] = useState<DashboardAgent | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  // Mötesläget (§ 34): null = stängt; objektet bär ev. förifyllnad/återupptag.
  const [meetingPanel, setMeetingPanel] = useState<MeetingInitial | null>(null);
  const [resumableMeetings, setResumableMeetings] = useState<ResumableMeeting[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const convsRef = useRef<Record<string, ConvState>>({});
  const activeThreadIdRef = useRef<string | null>(null);
  // Pågående trådskapande (Ny chatt) — delas av snabba dubbelsubmits.
  const creatingThreadRef = useRef<Promise<string | null> | null>(null);

  function updateConv(key: string, updater: (c: ConvState) => ConvState) {
    const cur = convsRef.current[key] ?? emptyConv();
    convsRef.current = { ...convsRef.current, [key]: updater(cur) };
    setConvs(convsRef.current);
  }

  function dropConv(key: string) {
    if (!(key in convsRef.current)) return;
    const next = { ...convsRef.current };
    delete next[key];
    convsRef.current = next;
    setConvs(next);
  }

  function setActive(id: string | null) {
    activeThreadIdRef.current = id;
    setActiveThreadId(id);
  }

  const activeKey = activeThreadId ?? DRAFT_KEY;
  const activeConv = convs[activeKey];
  const streaming = activeConv?.streaming ?? false;
  const deepRunning = isDeepRunning(activeConv);
  const starting = activeConv?.starting ?? false;
  const queuedItems: QueuedItem[] = (activeConv?.queue ?? []).map((q) => ({
    id: q.id,
    content: q.displayText
  }));

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
    submit(prompt, { includeWebContext: false, attachments: [], deepJob: false });
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ── Djupa jobb ────────────────────────────────────────────────────────────
  // Pollar ALLA pågående djupjobb (ett per tråd kan köra samtidigt) och laddar
  // in utkastet i respektive tråd när det är klart. Intervallet beror bara på
  // ANTALET körande jobb (stabilt), inte på convs-objektet — annars skulle
  // varje streamad token i en annan tråd nollställa timern.
  const runningDeepCount = Object.values(convs).filter(
    (c) => isDeepRunning(c) && c.deepJob?.id
  ).length;

  useEffect(() => {
    if (runningDeepCount === 0) return;
    const timer = setInterval(async () => {
      const entries = Object.entries(convsRef.current).filter(
        ([, c]) => c.deepJob?.id && !DEEP_TERMINAL.includes(c.deepJob.status)
      );
      for (const [threadId, c] of entries) {
        const jobId = c.deepJob!.id;
        let res: Awaited<ReturnType<typeof getDeepJobStatusAction>>;
        try {
          res = await getDeepJobStatusAction(jobId);
        } catch (err) {
          // Stale deploy → pollen kan ALDRIG lyckas igen i den här fliken för
          // just det jobbet. Släpp låset lokalt i den tråden (jobbet kör
          // vidare server-side och utkastet finns i tråden efter omladdning),
          // markera det som avslutat och kör vidare kön i just den tråden.
          // Övriga fel (nätverksglapp) → hoppa över ticken, försök igen nästa.
          if (isStaleDeploymentError(err)) {
            updateConv(threadId, (cur) =>
              cur.deepJob && cur.deepJob.id === jobId
                ? { ...cur, deepJob: { ...cur.deepJob, status: 'failed' }, error: STALE_DEPLOYMENT_MESSAGE }
                : cur
            );
            runNext(threadId);
          }
          continue;
        }
        if (res.error || !res.status) continue;
        const status = res.status;
        // Överlappande ticks (långsamma anrop) får inte processa samma
        // terminala jobb två gånger — kolla sanningen (ref) synkront igen.
        const live = convsRef.current[threadId]?.deepJob;
        if (!live || live.id !== jobId || DEEP_TERMINAL.includes(live.status)) continue;
        updateConv(threadId, (cur) =>
          cur.deepJob && cur.deepJob.id === jobId
            ? {
                ...cur,
                deepJob: { ...cur.deepJob, status, progress: res.progress ?? cur.deepJob.progress }
              }
            : cur
        );
        if (DEEP_TERMINAL.includes(status)) {
          // Best-effort: transkript + trådlista är dekorativa här — ett fel
          // får aldrig hindra att upptagen-flaggan släpps och kön dras vidare.
          const msgs = await getThreadMessagesAction(threadId).catch(() => null);
          const inactive = activeThreadIdRef.current !== threadId;
          updateConv(threadId, (cur) => ({
            ...cur,
            messages: msgs?.messages ? toUiMessages(msgs.messages) : cur.messages,
            loaded: true,
            error:
              status === 'failed' ? res.jobError || 'Djupdykningen misslyckades.' : cur.error,
            unread: status === 'succeeded' && inactive ? true : cur.unread
          }));
          await refreshThreads();
          // Jobbet klart → kör nästa köade meddelande i den tråden.
          runNext(threadId);
        }
      }
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningDeepCount, refreshThreads]);

  // Startar ett djupt jobb i en given tråd. Användarmeddelandet är redan
  // tillagt av runTurn; vid fel städas upptagen-flaggan och kön dras vidare.
  async function startDeep(threadId: string, instruction: string) {
    const clean = instruction.trim();
    updateConv(threadId, (c) => ({ ...c, starting: true }));
    if (!clean) {
      updateConv(threadId, (c) => ({ ...c, starting: false, error: 'Beskriv vad djupdykningen ska göra.' }));
      runNext(threadId);
      return;
    }
    // Tråden finns redan (skapad av anroparen innan detta jobb köades) — vi
    // behöver aldrig skapa en här som i den globala arkitekturen.
    let res: Awaited<ReturnType<typeof startDeepJobAction>>;
    try {
      res = await startDeepJobAction(threadId, clean);
    } catch (err) {
      // En kastad server action (t.ex. stale deploy: UnrecognizedActionError)
      // lämnade tidigare `starting=true` för evigt → chatten låstes.
      console.error('[ChattWorkspace] djupdykning kunde inte startas', err);
      res = { error: actionErrorMessage(err, 'Kunde inte starta djupdykningen — försök igen.') };
    }
    if (res.error || !res.jobId) {
      updateConv(threadId, (c) => ({
        ...c,
        starting: false,
        error: res.error || 'Kunde inte starta jobbet.'
      }));
      runNext(threadId);
      return;
    }
    updateConv(threadId, (c) => ({
      ...c,
      starting: false,
      deepJob: { id: res.jobId!, status: 'queued', progress: 0 }
    }));
    // Best-effort — jobbet är redan igång; pollen tar det härifrån.
    const msgs = await getThreadMessagesAction(threadId).catch(() => null);
    if (msgs?.messages) {
      updateConv(threadId, (c) => ({ ...c, messages: toUiMessages(msgs.messages!), loaded: true }));
    }
    await refreshThreads();
  }

  function cancelQueued(id: string) {
    updateConv(activeKey, (c) => ({ ...c, queue: c.queue.filter((q) => q.id !== id) }));
  }

  function newChat() {
    // Kön i en pågående tråd lever kvar (den är per tråd) — bara utkastet nollas.
    dropConv(DRAFT_KEY);
    setActive(null);
    setActiveAgent(null);
  }

  async function openThread(id: string) {
    setMenuFor(null);
    setActive(id);
    // Öppnad → läst. (Gul "väntar på dig" härleds ur meddelandena och ligger
    // kvar tills godkännandet faktiskt besvaras.)
    updateConv(id, (c) => ({ ...c, unread: false }));
    const existing = convsRef.current[id];
    if (existing?.loaded) {
      // Tråden är redan i minnet (ev. mitt i en körning) — visa den direkt.
      setActiveAgent(existing.agentId ? agents.find((a) => a.id === existing.agentId) || null : null);
      return;
    }
    try {
      const res = await getThreadMessagesAction(id);
      if (res.error) {
        // `loaded` lämnas false så nästa klick på tråden försöker läsa igen.
        updateConv(id, (c) => ({ ...c, error: res.error! }));
        return;
      }
      updateConv(id, (c) => ({
        ...c,
        messages: toUiMessages(res.messages || []),
        loaded: true,
        agentId: res.agent || null,
        unread: false
      }));
      setActiveAgent(res.agent ? agents.find((a) => a.id === res.agent) || null : null);
    } catch (err) {
      updateConv(id, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte öppna chatten — försök igen.')
      }));
    }
  }

  function applyStep(
    threadId: string,
    ev: { phase: 'start' | 'end'; id: string; label: string; ok?: boolean }
  ) {
    updateConv(threadId, (c) => {
      // Ett verktygssteg startar → ev. text som strömmats innan dess var en
      // inledning före verktygsanropet, inte slutsvaret. Nolla den löpande
      // texten så bara det riktiga svaret (som strömmas EFTER stegen) blir kvar.
      const liveText = ev.phase === 'start' ? '' : c.liveText;
      if (ev.phase === 'start') {
        if (c.liveSteps.some((s) => s.id === ev.id)) return { ...c, liveText };
        return { ...c, liveText, liveSteps: [...c.liveSteps, { id: ev.id, label: ev.label, running: true }] };
      }
      return {
        ...c,
        liveText,
        liveSteps: c.liveSteps.map((s) => (s.id === ev.id ? { ...s, running: false, ok: ev.ok } : s))
      };
    });
  }

  // Icke-streamande fallback (server-action) om streaming inte är tillgänglig.
  // Returnerar true när svaret faktiskt landade i tråden.
  async function fallbackTurn(threadId: string, text: string, opts: SubmitOpts): Promise<boolean> {
    const res = await sendThreadMessageAction(threadId, text, {
      includeWebContext: opts.includeWebContext,
      attachments: opts.attachments
    });
    if (res.error) {
      updateConv(threadId, (c) => ({ ...c, error: res.error! }));
      return false;
    }
    if (res.messages) {
      updateConv(threadId, (c) => ({ ...c, messages: toUiMessages(res.messages!), loaded: true }));
    }
    await refreshThreads();
    return true;
  }

  async function runStreamingTurn(threadId: string, text: string, opts: SubmitOpts) {
    updateConv(threadId, (c) => ({ ...c, streaming: true, liveSteps: [], liveText: '' }));
    // true när assistentens svar landade (styr den gröna oläst-pricken).
    let landed = false;
    try {
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
            attachments: opts.attachments
          })
        });
      } catch {
        // Nätverks-/uppkopplingsfel → degradera till server-action.
        landed = await fallbackTurn(threadId, text, opts);
        return;
      }

      if (!res.ok || !res.body) {
        if (res.status >= 500) {
          landed = await fallbackTurn(threadId, text, opts);
        } else {
          let msg = 'Kunde inte hämta svar just nu — försök igen.';
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* behåll default */
          }
          updateConv(threadId, (c) => ({ ...c, error: msg }));
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
          if (ev.type === 'step') {
            applyStep(threadId, ev as unknown as { phase: 'start' | 'end'; id: string; label: string; ok?: boolean });
          } else if (ev.type === 'token') {
            const delta = ev.delta;
            if (typeof delta === 'string' && delta) {
              updateConv(threadId, (c) => ({ ...c, liveText: c.liveText + delta }));
            }
          } else if (ev.type === 'final') {
            gotFinal = true;
            landed = true;
            // Persisterade meddelandet ersätter den live-strömmade texten —
            // nolla liveText så svaret inte visas dubbelt en kort stund.
            if (Array.isArray(ev.messages)) {
              const msgs = toUiMessages(ev.messages as ToolRunMessage[]);
              updateConv(threadId, (c) => ({ ...c, liveText: '', messages: msgs, loaded: true }));
            } else {
              updateConv(threadId, (c) => ({ ...c, liveText: '' }));
            }
          } else if (ev.type === 'error') {
            gotError = true;
            updateConv(threadId, (c) => ({
              ...c,
              error: typeof ev.error === 'string' ? (ev.error as string) : 'Kunde inte hämta svar just nu — försök igen.'
            }));
          }
        }
      }

      // Strömmen stängdes utan ett slutgiltigt meddelande (t.ex. proxy bröt
      // anslutningen) — turen kan ändå ha sparats server-side, så ladda om.
      if (!gotFinal && !gotError) {
        const msgs = await getThreadMessagesAction(threadId).catch(() => null);
        if (msgs?.messages) {
          landed = true;
          updateConv(threadId, (c) => ({ ...c, messages: toUiMessages(msgs.messages!), loaded: true }));
        }
      }
      await refreshThreads();
    } catch (err) {
      // Oväntat fel mitt i turen (t.ex. avbruten läsning, stale deploy i
      // fallbackTurn) — visa ett fel i tråden i stället för att tyst lämna
      // den hängande.
      console.error('[ChattWorkspace] chatturen misslyckades', err);
      updateConv(threadId, (c) => ({
        ...c,
        error: c.error || actionErrorMessage(err, 'Kunde inte hämta svar just nu — försök igen.')
      }));
    } finally {
      const inactive = activeThreadIdRef.current !== threadId;
      updateConv(threadId, (c) => ({
        ...c,
        streaming: false,
        liveSteps: [],
        liveText: '',
        // Blev klar i bakgrunden → grön prick tills tråden öppnas.
        unread: landed && inactive ? true : c.unread
      }));
      // Turen klar → kör nästa köade meddelande i samma tråd. Andra trådars
      // körningar är oberoende och påverkas inte.
      runNext(threadId);
    }
  }

  // Kör nästa köade meddelande i EN tråd om den inte redan kör något.
  function runNext(threadId: string) {
    const conv = convsRef.current[threadId];
    if (!conv) return;
    if (conv.starting || conv.streaming || isDeepRunning(conv)) return;
    const next = conv.queue[0];
    if (!next) return;
    updateConv(threadId, (c) => ({ ...c, queue: c.queue.slice(1) }));
    runTurn(threadId, next);
  }

  // Visar användarmeddelandet i transkriptet och kör turen (streaming/djupt).
  function runTurn(threadId: string, item: QueuedTurn) {
    updateConv(threadId, (c) => ({
      ...c,
      messages: [...c.messages, { role: 'user', content: item.displayText }],
      error: null,
      unread: false
    }));
    if (item.opts.deepJob) {
      void startDeep(threadId, item.text);
    } else {
      void runStreamingTurn(threadId, item.text, item.opts);
    }
  }

  // Skapar tråden för utkastet ("Ny chatt") EN gång och migrerar utkastets
  // tillstånd (kö + ev. meddelanden) till det riktiga tråd-id:t.
  function ensureThreadFromDraft(): Promise<string | null> {
    if (!creatingThreadRef.current) {
      creatingThreadRef.current = (async () => {
        let created: Awaited<ReturnType<typeof createThreadAction>>;
        try {
          created = await createThreadAction(activeAgent?.id);
        } catch (err) {
          created = { error: err instanceof Error ? err.message : 'Kunde inte skapa tråd.' };
        }
        if (created.error || !created.threadId) {
          updateConv(DRAFT_KEY, (c) => ({
            ...c,
            starting: false,
            queue: [],
            error: created.error || 'Kunde inte skapa tråd.'
          }));
          return null;
        }
        const id = created.threadId;
        const draft = convsRef.current[DRAFT_KEY] ?? emptyConv();
        const next = {
          ...convsRef.current,
          [id]: { ...draft, starting: false, loaded: true, agentId: activeAgent?.id ?? null }
        };
        delete next[DRAFT_KEY];
        convsRef.current = next;
        setConvs(next);
        // Byt bara vy om användaren fortfarande står kvar i utkastet — har hen
        // hunnit öppna en annan tråd fortsätter körningen i bakgrunden.
        if (activeThreadIdRef.current === null) setActive(id);
        void refreshThreads();
        return id;
      })();
      creatingThreadRef.current.finally(() => {
        creatingThreadRef.current = null;
      });
    }
    return creatingThreadRef.current;
  }

  async function dispatchSubmit(item: QueuedTurn) {
    const threadId = activeThreadIdRef.current;
    if (threadId) {
      updateConv(threadId, (c) => ({ ...c, error: null }));
      if (isBusy(convsRef.current[threadId])) {
        updateConv(threadId, (c) => ({ ...c, queue: [...c.queue, item] }));
        return;
      }
      runTurn(threadId, item);
      return;
    }
    // Utkast: köa meddelandet lokalt (visas direkt), skapa tråden och kör.
    updateConv(DRAFT_KEY, (c) => ({
      ...c,
      loaded: true,
      starting: true,
      error: null,
      queue: [...c.queue, item]
    }));
    const createdId = await ensureThreadFromDraft();
    if (!createdId) return;
    runNext(createdId);
  }

  function submit(text: string, opts: SubmitOpts) {
    const displayText = opts.deepJob
      ? text
      : text || (opts.attachments.length === 1 ? '(bilaga skickad)' : '(bilagor skickade)');
    const item: QueuedTurn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      opts,
      displayText
    };
    void dispatchSubmit(item);
  }

  // Svar på agentens godkännandefråga (§ 33): skickas som en vanlig user-tur
  // ("Godkänn"/"Avbryt") så beslutet syns i transkriptet och persisteras i
  // tråden — agenten utför (eller avstår) i nästa svar.
  function onApproval(approved: boolean) {
    submit(approved ? 'Godkänn' : 'Avbryt', {
      includeWebContext: false,
      attachments: [],
      deepJob: false
    });
  }

  async function onDownload(file: GeneratedFileRef) {
    try {
      const res = await getFileDownloadUrlAction(file.user_file_id);
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        updateConv(activeKey, (c) => ({ ...c, error: res.error || 'Kunde inte hämta filen.' }));
      }
    } catch (err) {
      updateConv(activeKey, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte hämta filen — försök igen.')
      }));
    }
  }

  async function doRename(item: ThreadListItem) {
    setMenuFor(null);
    const title = window.prompt('Byt namn på chatten', item.title);
    if (title == null) return;
    try {
      await renameThreadAction(item.id, title);
    } catch (err) {
      updateConv(activeKey, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte byta namn på chatten.')
      }));
    }
    await refreshThreads();
  }

  async function doPin(item: ThreadListItem) {
    setMenuFor(null);
    try {
      await pinThreadAction(item.id, !item.pinned);
    } catch (err) {
      updateConv(activeKey, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte fästa chatten.')
      }));
    }
    await refreshThreads();
  }

  async function doArchive(item: ThreadListItem) {
    setMenuFor(null);
    try {
      await archiveThreadAction(item.id, item.status !== 'archived');
    } catch (err) {
      updateConv(activeKey, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte arkivera chatten.')
      }));
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
      dropConv(item.id);
      if (activeThreadId === item.id) newChat();
    } catch (err) {
      updateConv(activeKey, (c) => ({
        ...c,
        error: actionErrorMessage(err, 'Kunde inte radera chatten.')
      }));
    }
    await refreshThreads();
  }

  function ThreadRow({ item }: { item: ThreadListItem }) {
    const selected = item.id === activeThreadId;
    const status = statusFor(convs[item.id]);
    return (
      <div
        className={`group relative flex items-center gap-1 rounded-xl px-2 py-1.5 text-[13px] transition ${
          selected ? 'bg-canvas-muted text-foreground' : 'text-foreground-muted hover:bg-canvas-subtle'
        }`}
      >
        <button
          type="button"
          onClick={() => void openThread(item.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {status && (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status].cls}`}
              title={STATUS_DOT[status].label}
              aria-label={STATUS_DOT[status].label}
            />
          )}
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

  // Antal trådar med en pågående körning — visas i sidopanelens sidfot så det
  // syns att andra chattar arbetar även när man står i en annan.
  const workingCount = Object.entries(convs).filter(
    ([key, c]) => key !== DRAFT_KEY && (c.starting || c.streaming || isDeepRunning(c) || c.queue.length > 0)
  ).length;

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
          messages={activeConv?.messages ?? []}
          isPending={streaming || deepRunning || starting}
          error={activeConv?.error ?? null}
          activeAgent={activeAgent}
          deepRunning={deepRunning}
          deepProgress={activeConv?.deepJob?.progress ?? 0}
          liveSteps={activeConv?.liveSteps ?? []}
          liveText={activeConv?.liveText ?? ''}
          queued={queuedItems}
          resetSignal={activeThreadId ?? 'new'}
          onPickAgent={setActiveAgent}
          onReset={newChat}
          onSubmit={submit}
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
          {/* Förklaring av statusprickarna — flera chattar kan arbeta parallellt. */}
          <div className="border-t border-default px-3 py-2.5">
            {workingCount > 0 && (
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-movexum-bla" aria-hidden />
                {workingCount === 1 ? '1 chatt arbetar' : `${workingCount} chattar arbetar`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-foreground-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-movexum-bla" aria-hidden /> Arbetar
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-movexum-gul" aria-hidden /> Väntar på dig
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-movexum-gron" aria-hidden /> Klart
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-movexum-orange" aria-hidden /> Fel
              </span>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
