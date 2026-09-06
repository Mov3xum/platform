'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_MEETING_SECONDS,
  MAX_MEETING_SEGMENTS,
  MEETING_CONSENT_TEXT,
  MEETING_FIRST_SEGMENT_SECONDS,
  MEETING_SEGMENT_SECONDS,
  MIN_VOICE_BYTES,
  formatMeetingClock,
  validateVoiceClip
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import { pickRecorderMime } from '@/components/VoiceInputButton';
import {
  discardMeetingAction,
  endMeetingAction,
  generateMeetingProtocolAction,
  getMeetingAction,
  getMeetingPrefillAction,
  listMeetingStartupsAction,
  saveMeetingToStartupAction,
  startMeetingAction,
  structureMeetingTranscriptAction,
  type MeetingStartupOption
} from '@/lib/actions/meetings';

/**
 * Mötesläget i chatten (CLAUDE.md § 34). Hela flödet i en panel:
 *
 *   1. Uppstart — välj bolag/titel och bekräfta SAMTYCKESGRINDEN (GDPR art. 7:
 *      mötet spelar in andra människor än användaren själv). Ingen inspelning
 *      utan bocken.
 *   2. Inspelning — MediaRecorder STARTAS OM var ~90:e sekund så varje segment
 *      blir en komplett fil som transkriberas direkt (Voxtral, Mistral EU) och
 *      dyker upp i live-transkriptet. Ljudet lämnar aldrig webbläsaren annat än
 *      i själva segment-anropet och lagras aldrig. En krasch kostar max ett
 *      segment — redan uppladdade segment finns kvar server-side.
 *   3. Granskning — redigerbart transkript, AI-protokollutkast och LLM-gissad
 *      turindelning (anonyma "Talare 1"-etiketter — ingen röstanalys, § 31.4).
 *   4. Sparande — en MÄNSKLIG knapptryckning som lägger protokollet som
 *      anteckning på valt bolagskort (valbar konfidentiell). Råtranskriptet
 *      purgas då (lagringsminimering).
 *
 * Människa-i-loopen i varje steg (EU AI Act art. 14): agenten kan förbereda
 * panelen (`start_meeting`) men aldrig starta inspelningen, aldrig bekräfta
 * samtycket och aldrig spara.
 */

export interface MeetingInitial {
  startupId?: string;
  startupName?: string;
  title?: string;
  /** Återuppta ett tidigare möte (status recording/ended) i granskningsläget. */
  resumeMeetingId?: string;
}

interface Props {
  initial?: MeetingInitial;
  onClose: () => void;
  /** Skickar en färdig prompt som en vanlig chatt-tur (t.ex. åtgärdsförslag). */
  onSendToChat?: (prompt: string) => void;
}

type Phase = 'setup' | 'recording' | 'finishing' | 'review' | 'saving' | 'saved';

interface LiveSegment {
  index: number;
  text: string;
  status: 'pending' | 'done' | 'failed';
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function MeetingMode({ initial, onClose, onSendToChat }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [startups, setStartups] = useState<MeetingStartupOption[]>([]);
  const [startupId, setStartupId] = useState(initial?.startupId || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [consent, setConsent] = useState(false);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  // Inspelning
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  // Senaste transkriberings-/uppladdningsfelet från servern — visas för
  // användaren i stället för att sväljas (annars är ett kort möte med ETT
  // fallerat segment bara "tomt transkript" utan förklaring).
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const segmentErrorRef = useRef<string | null>(null);
  const failedCountRef = useRef(0);

  // Granskning
  const [transcript, setTranscript] = useState('');
  const [protocol, setProtocol] = useState('');
  const [aiBusy, setAiBusy] = useState<null | 'protocol' | 'turns'>(null);
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [confidential, setConfidential] = useState(false);
  const [savedInfo, setSavedInfo] = useState<{ startupName: string; startupId: string } | null>(null);

  const meetingIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextIndexRef = useRef(0);
  const recordingRef = useRef(false);
  const discardedRef = useRef(false);
  const elapsedRef = useRef(0);
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // ── Miljökontroll: mikrofonen finns bara i säker kontext (https/localhost) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasApi =
      typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    if (hasApi) return;
    setBlockedReason(
      window.isSecureContext === false
        ? 'Mötesinspelning kräver en säker anslutning (https) — webbläsaren stänger av mikrofonen på http.'
        : 'Din webbläsare stöder inte ljudinspelning (MediaRecorder saknas). Prova Chrome, Edge, Firefox eller Safari 14+.'
    );
  }, []);

  // ── Bolagslista + Outlook-förifyllnad (fail-soft) ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listMeetingStartupsAction();
      if (!cancelled && res.startups) setStartups(res.startups);
      if (!cancelled && res.error) setError(res.error);
    })();
    if (!initial?.resumeMeetingId && !initial?.startupId && !initial?.title) {
      void (async () => {
        const prefill = await getMeetingPrefillAction();
        if (cancelled) return;
        if (prefill.title) {
          setTitle((cur) => cur || prefill.title || '');
          setPrefillNote(
            prefill.startupName
              ? `Förifyllt från ditt pågående Outlook-möte (${prefill.startupName}).`
              : 'Mötestiteln är förifylld från ditt pågående Outlook-möte.'
          );
        }
        if (prefill.startupId) setStartupId((cur) => cur || prefill.startupId || '');
      })();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Återuppta ett oavslutat möte direkt i granskningen ─────────────────────
  useEffect(() => {
    const resumeId = initial?.resumeMeetingId;
    if (!resumeId) return;
    let cancelled = false;
    void (async () => {
      // Ett möte som lämnades i 'recording' (kraschad flik) kan inte återuppta
      // själva inspelningen (strömmen är borta) — avsluta det och granska
      // det som hann transkriberas.
      const res = await endMeetingAction(resumeId);
      if (cancelled) return;
      if (res.error || !res.meeting) {
        setError(res.error || 'Kunde inte återuppta mötet.');
        return;
      }
      meetingIdRef.current = res.meeting.id;
      setTitle(res.meeting.title);
      setStartupId(res.meeting.startupId);
      setTranscript(res.meeting.transcript);
      setPhase('review');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.resumeMeetingId]);

  // ── Wake lock: håll skärmen vaken under inspelning (mic dör annars) ─────────
  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } })
        .wakeLock;
      if (wl) wakeLockRef.current = await wl.request('screen');
    } catch {
      /* wake lock är en förbättring, aldrig ett krav */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible' && recordingRef.current) {
        void requestWakeLock();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [requestWakeLock]);

  // ── Varna innan fliken stängs mitt i en inspelning ─────────────────────────
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (recordingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Städa vid unmount (panelen stängs mitt i något).
  useEffect(() => {
    return () => {
      recordingRef.current = false;
      if (segTimerRef.current) clearTimeout(segTimerRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        /* redan stoppad */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  function updateSegment(index: number, patch: Partial<LiveSegment>) {
    setSegments((prev) => prev.map((s) => (s.index === index ? { ...s, ...patch } : s)));
  }

  async function uploadSegment(blob: Blob, mime: string, index: number, attempt = 0): Promise<void> {
    const meetingId = meetingIdRef.current;
    if (!meetingId || discardedRef.current) return;
    try {
      const form = new FormData();
      form.append('meetingId', meetingId);
      form.append('segmentIndex', String(index));
      form.append('audio', new File([blob], `segment-${index}`, { type: mime }));
      const res = await fetch('/api/chat/meeting/segment', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Uppladdningen misslyckades.');
      updateSegment(index, { text: data.text || '', status: 'done' });
    } catch (err) {
      if (attempt === 0 && !discardedRef.current) {
        await sleep(1500);
        return uploadSegment(blob, mime, index, 1);
      }
      // Segmentet är förlorat — servern markerar luckan i transkriptet
      // (saknat index ⇒ lucka-markör), så coachen ser aldrig ett tyst hål.
      // ORSAKEN visas för användaren (Voxtral-/konfigurations-/behörighetsfel
      // ska aldrig sväljas till ett oförklarat tomt transkript).
      const message =
        err instanceof Error && err.message ? err.message : 'Uppladdningen misslyckades.';
      segmentErrorRef.current = message;
      failedCountRef.current += 1;
      setSegmentError(message);
      updateSegment(index, { status: 'failed' });
    }
  }

  function enqueueUpload(blob: Blob, mime: string, index: number) {
    setSegments((prev) => [...prev, { index, text: '', status: 'pending' }]);
    uploadChainRef.current = uploadChainRef.current.then(() => uploadSegment(blob, mime, index));
  }

  const startSegment = useCallback((stream: MediaStream) => {
    if (!recordingRef.current) return;
    const mimeType = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      recordingRef.current = false;
      setError('Din webbläsare stöder inte något ljudformat vi kan transkribera.');
      return;
    }
    const index = nextIndexRef.current++;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const validation = validateVoiceClip(type, blob.size);
      if (
        !discardedRef.current &&
        blob.size >= MIN_VOICE_BYTES &&
        validation.ok &&
        index < MAX_MEETING_SEGMENTS
      ) {
        enqueueUpload(blob, type, index);
      }
      if (recordingRef.current) startSegment(stream);
    };
    recorderRef.current = recorder;
    recorder.start();
    // Första segmentet hålls kort så att live-texten (eller ett fel) syns
    // snabbt — därefter ~90-sekunderssegment (MEETING_FIRST_SEGMENT_SECONDS).
    const segmentSeconds = index === 0 ? MEETING_FIRST_SEGMENT_SECONDS : MEETING_SEGMENT_SECONDS;
    segTimerRef.current = setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        /* redan stoppad */
      }
    }, segmentSeconds * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginRecording() {
    setError(null);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    if (!consent) {
      setError('Bekräfta att deltagarna är informerade innan mötet startas.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Mikrofonen är blockerad. Tillåt mikrofon för sidan och försök igen.'
          : 'Kunde inte starta mikrofonen.'
      );
      return;
    }

    const started = await startMeetingAction({
      startupId: startupId || null,
      title: title || null,
      consentConfirmed: consent
    });
    if (started.error || !started.meetingId) {
      stream.getTracks().forEach((t) => t.stop());
      setError(started.error || 'Kunde inte starta mötet.');
      return;
    }

    meetingIdRef.current = started.meetingId;
    streamRef.current = stream;
    discardedRef.current = false;
    recordingRef.current = true;
    nextIndexRef.current = 0;
    elapsedRef.current = 0;
    segmentErrorRef.current = null;
    failedCountRef.current = 0;
    setSegmentError(null);
    setSegments([]);
    setElapsed(0);
    setPhase('recording');
    void requestWakeLock();
    startSegment(stream);
    tickRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_MEETING_SECONDS) void finishMeeting();
    }, 1000);
  }

  function stopRecorder(): Promise<void> {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') {
        resolve();
        return;
      }
      const prev = rec.onstop;
      rec.onstop = function (this: MediaRecorder, ev: Event) {
        prev?.call(this, ev);
        resolve();
      };
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
  }

  async function finishMeeting() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (segTimerRef.current) clearTimeout(segTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase('finishing');
    await stopRecorder();
    releaseStream();
    releaseWakeLock();
    // Vänta in transkriberingskön så granskningen visar hela mötet.
    await uploadChainRef.current;
    const meetingId = meetingIdRef.current;
    if (!meetingId) {
      setPhase('setup');
      return;
    }
    const res = await endMeetingAction(meetingId);
    if (res.error || !res.meeting) {
      setError(res.error || 'Kunde inte avsluta mötet — försök igen.');
      setPhase('review');
      return;
    }
    const ended = res.meeting;
    setTranscript(ended.transcript);
    if (ended.startupId) setStartupId((cur) => cur || ended.startupId);
    // Föll segment bort ska granskningen förklara VARFÖR — särskilt när hela
    // transkriptet blev tomt (ett kort möte har bara ett enda segment).
    if (failedCountRef.current > 0) {
      const reason = segmentErrorRef.current;
      setError(
        `${failedCountRef.current} segment kunde inte transkriberas` +
          (reason ? `: ${reason}` : '.') +
          (ended.transcript.trim()
            ? ' De markeras som luckor i transkriptet.'
            : ' Transkriptet blev därför tomt.')
      );
    }
    setPhase('review');
  }

  async function discardMeeting() {
    const label =
      phase === 'recording'
        ? 'Avbryta inspelningen och radera transkriptet?'
        : 'Radera mötet och transkriptet permanent?';
    if (!window.confirm(label)) return;
    discardedRef.current = true;
    recordingRef.current = false;
    if (segTimerRef.current) clearTimeout(segTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    try {
      recorderRef.current?.stop();
    } catch {
      /* redan stoppad */
    }
    releaseStream();
    releaseWakeLock();
    const meetingId = meetingIdRef.current;
    if (meetingId) await discardMeetingAction(meetingId);
    onClose();
  }

  async function refreshTranscriptFromServer() {
    const meetingId = meetingIdRef.current;
    if (!meetingId) return;
    const res = await getMeetingAction(meetingId);
    if (res.meeting) setTranscript(res.meeting.transcript);
  }

  async function runProtocol() {
    const meetingId = meetingIdRef.current;
    if (!meetingId) return;
    setError(null);
    setAiBusy('protocol');
    try {
      const res = await generateMeetingProtocolAction(meetingId);
      if (res.error) setError(res.error);
      else if (res.protocol) setProtocol(res.protocol);
    } finally {
      setAiBusy(null);
    }
  }

  async function runTurnSplit() {
    const meetingId = meetingIdRef.current;
    if (!meetingId) return;
    setError(null);
    setAiBusy('turns');
    try {
      const res = await structureMeetingTranscriptAction(meetingId);
      if (res.error) setError(res.error);
      else if (res.transcript) setTranscript(res.transcript);
    } finally {
      setAiBusy(null);
    }
  }

  async function saveMeeting() {
    const meetingId = meetingIdRef.current;
    if (!meetingId) return;
    if (!startupId) {
      setError('Välj vilket bolagskort mötet ska sparas på.');
      return;
    }
    if (!protocol.trim() && !transcript.trim()) {
      setError('Det finns inget protokoll eller transkript att spara.');
      return;
    }
    setError(null);
    setPhase('saving');
    const res = await saveMeetingToStartupAction(meetingId, {
      startupId,
      confidential,
      includeTranscript,
      protocolText: protocol,
      transcriptText: includeTranscript ? transcript : undefined
    });
    if (res.error || !res.startupId) {
      setError(res.error || 'Kunde inte spara mötet.');
      setPhase('review');
      return;
    }
    setSavedInfo({ startupId: res.startupId, startupName: res.startupName || 'bolaget' });
    setPhase('saved');
  }

  function suggestActionsInChat() {
    if (!onSendToChat || !savedInfo) return;
    const basis = protocol.trim() || transcript.trim().slice(0, 4000);
    onSendToChat(
      `Här är protokollet från mötet med ${savedInfo.startupName}${title ? ` ("${title}")` : ''}:\n\n` +
        `${basis}\n\n` +
        'Föreslå utifrån åtgärdspunkterna vilka kanban-kort som bör skapas på bolagets tavla, ' +
        'om nästa steg bör uppdateras och om ett uppföljningsmöte bör bokas — och genomför det vi kommer överens om.'
    );
    onClose();
  }

  const doneSegments = segments.filter((s) => s.status === 'done');
  const failedSegments = segments.filter((s) => s.status === 'failed');
  const pendingCount = segments.filter((s) => s.status === 'pending').length;

  const heading =
    phase === 'setup'
      ? 'Starta ett möte'
      : phase === 'recording'
        ? 'Mötet spelas in'
        : phase === 'finishing'
          ? 'Avslutar mötet…'
          : phase === 'saved'
            ? 'Mötet är sparat'
            : 'Granska mötet';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/60 p-4 backdrop-blur-sm md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Mötesläge"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-default px-5 py-3.5">
          <span className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-movexum-pastell-lila text-movexum-morklila">
              <Icon name="mic" size={15} />
            </span>
            <span className="font-heading text-[15px] font-semibold text-foreground">{heading}</span>
            {phase === 'recording' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-movexum-lila px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-movexum-vit">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-movexum-vit" aria-hidden="true" />
                {formatMeetingClock(elapsed)}
              </span>
            )}
          </span>
          {phase !== 'recording' && phase !== 'finishing' && phase !== 'saving' && (
            <button
              type="button"
              onClick={phase === 'review' ? discardMeeting : onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
              title={phase === 'review' ? 'Kasta mötet' : 'Stäng'}
              aria-label={phase === 'review' ? 'Kasta mötet' : 'Stäng'}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
              {error}
            </div>
          )}

          {/* ── Uppstart ── */}
          {phase === 'setup' && (
            <div className="flex flex-col gap-4">
              <p className="text-[13.5px] leading-relaxed text-foreground-muted">
                Allt som sägs transkriberas live (Voxtral, Mistral — EU-suveränt) och kan efter
                granskning sparas som anteckning på ett bolagskort. Ljudet lagras aldrig.
              </p>
              {prefillNote && (
                <p className="rounded-xl bg-movexum-pastell-bla px-3 py-2 text-[12.5px] text-movexum-djupbla">
                  {prefillNote}
                </p>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                  Mötestitel (valfri)
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="T.ex. Coachmöte september"
                  className="rounded-xl border border-default bg-canvas px-3 py-2 text-[14px] text-foreground placeholder:text-foreground-subtle focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                  Bolag (kan väljas/ändras efter mötet)
                </span>
                <select
                  value={startupId}
                  onChange={(e) => setStartupId(e.target.value)}
                  className="rounded-xl border border-default bg-canvas px-3 py-2 text-[14px] text-foreground focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                >
                  <option value="">— Välj senare —</option>
                  {startups.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-start gap-2.5 rounded-xl border border-default bg-canvas-subtle p-3">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
                />
                <span className="text-[13px] leading-relaxed text-foreground">
                  {MEETING_CONSENT_TEXT}
                </span>
              </label>

              {blockedReason && (
                <p className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12.5px] text-movexum-morkgul">
                  {blockedReason}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-default px-4 py-2 text-[13px] font-medium text-foreground-muted transition hover:border-strong hover:text-foreground"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={beginRecording}
                  disabled={!consent || !!blockedReason}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="mic" size={13} />
                  Starta mötet
                </button>
              </div>
            </div>
          )}

          {/* ── Inspelning ── */}
          {(phase === 'recording' || phase === 'finishing') && (
            <div className="flex flex-col gap-3">
              <p className="text-[12.5px] text-foreground-subtle">
                Transkriberas löpande — första texten dyker upp efter ca{' '}
                {MEETING_FIRST_SEGMENT_SECONDS} sekunder, därefter i ~{MEETING_SEGMENT_SECONDS}
                -sekunderssegment. Lämna gärna fliken öppen — skärmen hålls vaken under
                inspelningen.
              </p>
              <div className="flex min-h-[180px] flex-col gap-2 rounded-xl border border-default bg-canvas-subtle p-3">
                {doneSegments.length === 0 && pendingCount === 0 ? (
                  <p className="text-[13px] italic text-foreground-subtle">
                    Transkriptet dyker upp här allteftersom ni pratar…
                  </p>
                ) : (
                  <>
                    {doneSegments.map((s) =>
                      s.text ? (
                        <p key={s.index} className="text-[13.5px] leading-relaxed text-foreground">
                          {s.text}
                        </p>
                      ) : null
                    )}
                    {pendingCount > 0 && (
                      <p className="inline-flex items-center gap-2 text-[12.5px] text-foreground-subtle">
                        <span className="h-3 w-3 animate-spin rounded-full border border-foreground-subtle border-t-transparent" aria-hidden />
                        Transkriberar {pendingCount} segment…
                      </p>
                    )}
                  </>
                )}
                {failedSegments.length > 0 && (
                  <p className="text-[12px] text-movexum-morkorange">
                    {failedSegments.length} segment kunde inte transkriberas
                    {segmentError ? ` (${segmentError})` : ''} — de markeras som luckor i
                    transkriptet.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={discardMeeting}
                  disabled={phase === 'finishing'}
                  className="rounded-xl px-3 py-2 text-[12.5px] text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-40"
                >
                  Avbryt utan att spara
                </button>
                <button
                  type="button"
                  onClick={finishMeeting}
                  disabled={phase === 'finishing'}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
                >
                  {phase === 'finishing' ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-foreground border-t-transparent" aria-hidden />
                      Väntar in transkriberingen…
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={13} />
                      Avsluta mötet
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Granskning ── */}
          {(phase === 'review' || phase === 'saving') && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                    Transkript (redigerbart)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={runTurnSplit}
                      disabled={aiBusy !== null || !transcript.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition hover:border-strong hover:text-foreground disabled:opacity-40"
                      title='Dela upp texten i anonyma repliker ("Talare 1/2") — en språklig gissning, ingen röstanalys. Du kan döpa talarna själv efteråt.'
                    >
                      {aiBusy === 'turns' ? (
                        <span className="h-3 w-3 animate-spin rounded-full border border-foreground-subtle border-t-transparent" aria-hidden />
                      ) : (
                        <Icon name="people" size={12} />
                      )}
                      Dela upp i repliker
                    </button>
                    <button
                      type="button"
                      onClick={refreshTranscriptFromServer}
                      disabled={aiBusy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition hover:border-strong hover:text-foreground disabled:opacity-40"
                      title="Hämta om originaltranskriptet från servern (ångra redigeringar)"
                    >
                      Återställ
                    </button>
                  </span>
                </div>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={8}
                  className="rounded-xl border border-default bg-canvas px-3 py-2 text-[13.5px] leading-relaxed text-foreground focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                  placeholder="Tomt transkript — ingen text kunde höras i mötet."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                    Protokoll
                  </span>
                  <button
                    type="button"
                    onClick={runProtocol}
                    disabled={aiBusy !== null || !transcript.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-movexum-pastell-lila px-2.5 py-1 text-[12px] font-medium text-movexum-morklila transition hover:bg-movexum-lila hover:text-movexum-vit disabled:opacity-40"
                    title="Generera ett protokollutkast (sammanfattning, beslut, åtgärdspunkter) med AI — granska och redigera innan du sparar"
                  >
                    {aiBusy === 'protocol' ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-movexum-morklila border-t-transparent" aria-hidden />
                    ) : (
                      <Icon name="sparkle" size={12} />
                    )}
                    {protocol ? 'Generera om' : 'Generera protokoll'}
                  </button>
                </div>
                <textarea
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  rows={7}
                  className="rounded-xl border border-default bg-canvas px-3 py-2 text-[13.5px] leading-relaxed text-foreground focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                  placeholder="Skriv protokollet själv, eller låt AI ta fram ett utkast som du granskar."
                />
                {protocol && (
                  <p className="text-[11.5px] text-foreground-subtle">
                    Genererat av AI – verifiera innan delning.
                  </p>
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                  Spara på bolagskort
                </span>
                <select
                  value={startupId}
                  onChange={(e) => setStartupId(e.target.value)}
                  className="rounded-xl border border-default bg-canvas px-3 py-2 text-[14px] text-foreground focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                >
                  <option value="">— Välj bolag —</option>
                  {startups.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input
                    type="checkbox"
                    checked={includeTranscript}
                    onChange={(e) => setIncludeTranscript(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  Bifoga hela transkriptet i anteckningen (annars sparas bara protokollet)
                </label>
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input
                    type="checkbox"
                    checked={confidential}
                    onChange={(e) => setConfidential(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  Konfidentiell anteckning (visas bara för behöriga och exkluderas ur all AI-kontext)
                </label>
              </div>

              <p className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12px] text-movexum-morkgul">
                När du sparar raderas råtranskriptet permanent — anteckningen på bolagskortet blir
                den enda kopian. Osparade möten raderas automatiskt efter 7 dagar.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={discardMeeting}
                  disabled={phase === 'saving'}
                  className="rounded-xl px-3 py-2 text-[12.5px] text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-40"
                >
                  Kasta mötet
                </button>
                <button
                  type="button"
                  onClick={saveMeeting}
                  disabled={phase === 'saving' || !startupId}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {phase === 'saving' ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-foreground border-t-transparent" aria-hidden />
                      Sparar…
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={13} />
                      Spara på bolagskortet
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Sparat ── */}
          {phase === 'saved' && savedInfo && (
            <div className="flex flex-col items-start gap-4">
              <p className="text-[14px] leading-relaxed text-foreground">
                Mötesanteckningen är sparad på{' '}
                <a href={`/startups/${savedInfo.startupId}`} className="font-medium text-link underline">
                  {savedInfo.startupName}
                </a>{' '}
                och syns i aktivitetsfeeden. Råtranskriptet är raderat.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {onSendToChat && (protocol.trim() || transcript.trim()) && (
                  <button
                    type="button"
                    onClick={suggestActionsInChat}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover"
                    title="Skickar protokollet till chatten och ber agenten föreslå uppgifter, nästa steg och uppföljning"
                  >
                    <Icon name="sparkle" size={13} />
                    Föreslå uppgifter i chatten
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-default px-4 py-2 text-[13px] font-medium text-foreground-muted transition hover:border-strong hover:text-foreground"
                >
                  Stäng
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-default px-5 py-2.5">
          <p className="text-[11px] text-foreground-subtle">
            AI-transkribering drivs av Voxtral (Mistral, Frankrike — EU-suveränt). Ljudet lagras
            aldrig; ingen röstigenkänning eller biometrisk analys görs. Genererat av AI – verifiera
            innan delning.
          </p>
        </div>
      </div>
    </div>
  );
}
