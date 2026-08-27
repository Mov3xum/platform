'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_VOICE_SECONDS,
  VOICE_MIME_TYPES,
  formatVoiceDuration,
  validateVoiceClip
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';

/**
 * Mikrofonknapp för chatten (CLAUDE.md § 31). Spelar in ett ljudklipp med
 * webbläsarens MediaRecorder, skickar det till `/api/chat/voice` (Voxtral,
 * Mistral EU) och lämnar tillbaka den transkriberade texten till chattrutan.
 *
 * Människa-i-loopen (EU AI Act art. 14): transkriptet SKICKAS INTE automatiskt
 * — det landar i inmatningsfältet där användaren läser igenom, rättar och
 * själv trycker skicka. Röst är alltså bara ett annat sätt att skriva; alla
 * skrivningar går fortfarande genom det delade skrivlagret med bekräftelse.
 *
 * Integritet: ljudet lämnar aldrig webbläsaren annat än i själva anropet, och
 * lagras varken lokalt eller på servern. Mikrofon-strömmen stängs direkt när
 * inspelningen stoppas (inga tända mikrofon-indikatorer som ligger kvar).
 */

interface Props {
  /** Anropas med den transkriberade texten när den kommit tillbaka. */
  onTranscript: (text: string) => void;
  /** Inaktiverar knappen (t.ex. medan en bilaga läses in). */
  disabled?: boolean;
  /** Bubblar upp felmeddelanden till chattens felruta. */
  onError?: (message: string) => void;
}

type Phase = 'idle' | 'recording' | 'transcribing';

/** Varför röstinmatning inte är tillgänglig (null = allt fungerar). */
type BlockedReason = null | 'insecure' | 'unsupported';

const BLOCKED_MESSAGES: Record<'insecure' | 'unsupported', string> = {
  insecure:
    'Röstinmatning kräver en säker anslutning (https). Sidan är serverad över ' +
    'http, och webbläsaren stänger då av mikrofonen helt.',
  unsupported:
    'Din webbläsare stöder inte röstinspelning (MediaRecorder saknas). Prova ' +
    'Chrome, Edge, Firefox eller Safari 14+.'
};

/** Första mime-typen webbläsaren faktiskt kan spela in. */
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return undefined;
}

export default function VoiceInputButton({ onTranscript, disabled, onError }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [blocked, setBlocked] = useState<BlockedReason>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const elapsedRef = useRef(0);

  const stopTicker = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Städa upp om komponenten försvinner mitt i en inspelning.
  useEffect(() => {
    return () => {
      stopTicker();
      try {
        recorderRef.current?.stop();
      } catch {
        /* redan stoppad */
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [stopTicker]);

  // Varför mikrofonen ev. inte går att använda. Vi döljer ALDRIG knappen tyst —
  // en osynlig knapp är omöjlig att felsöka ("jag ser ingen röststyrning").
  // I stället visas den avstängd med en förklaring i tooltip:en, och ett
  // klick lägger samma text i chattens felruta.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasApi =
      typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    if (hasApi) {
      setBlocked(null);
      return;
    }
    // `getUserMedia` finns bara i en säker kontext (https eller localhost) —
    // på en http-serverad miljö är API:et helt borta, inte bara nekat.
    setBlocked(window.isSecureContext === false ? 'insecure' : 'unsupported');
  }, []);

  const fail = useCallback(
    (message: string) => {
      onError?.(message);
      setPhase('idle');
    },
    [onError]
  );

  async function sendClip(blob: Blob, mime: string) {
    const validation = validateVoiceClip(mime, blob.size);
    if (!validation.ok) {
      fail(validation.error);
      return;
    }

    setPhase('transcribing');
    const form = new FormData();
    // Filnamnet är bara en etikett — servern går på mime-typen.
    form.append('audio', new File([blob], 'rost-inspelning', { type: validation.mime }));

    try {
      const response = await fetch('/api/chat/voice', { method: 'POST', body: form });
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!response.ok || !data.text) {
        fail(data.error || 'Kunde inte transkribera inspelningen.');
        return;
      }
      onTranscript(data.text);
      setPhase('idle');
    } catch {
      fail('Kunde inte nå servern för transkribering.');
    }
  }

  async function startRecording() {
    if (blocked) {
      fail(BLOCKED_MESSAGES[blocked]);
      return;
    }
    onError?.('');
    cancelledRef.current = false;
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      fail(
        name === 'NotAllowedError'
          ? 'Mikrofonen är blockerad. Tillåt mikrofon för sidan och försök igen.'
          : 'Kunde inte starta mikrofonen.'
      );
      return;
    }
    streamRef.current = stream;

    const mimeType = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream();
      fail('Din webbläsare stöder inte något ljudformat vi kan transkribera.');
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopTicker();
      releaseStream();
      const type = recorder.mimeType || mimeType || VOICE_MIME_TYPES[0];
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      recorderRef.current = null;
      if (cancelledRef.current) {
        setPhase('idle');
        return;
      }
      void sendClip(blob, type);
    };

    recorder.start();
    elapsedRef.current = 0;
    setSeconds(0);
    setPhase('recording');
    tickRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setSeconds(elapsedRef.current);
      // Hårt tak: en glömd inspelning ska inte bli en dyr transkribering.
      if (elapsedRef.current >= MAX_VOICE_SECONDS) stopRecording();
    }, 1000);
  }

  function stopRecording() {
    stopTicker();
    try {
      recorderRef.current?.stop();
    } catch {
      releaseStream();
      setPhase('idle');
    }
  }

  function cancelRecording() {
    cancelledRef.current = true;
    stopRecording();
  }

  if (blocked) {
    return (
      <button
        type="button"
        onClick={() => fail(BLOCKED_MESSAGES[blocked])}
        aria-label="Röstinmatning är inte tillgänglig"
        title={BLOCKED_MESSAGES[blocked]}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle opacity-40 transition hover:bg-canvas-muted"
      >
        <Icon name="mic" size={14} />
      </button>
    );
  }

  if (phase === 'recording') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={stopRecording}
          className="inline-flex items-center gap-1.5 rounded-full bg-movexum-lila px-3 py-1 text-[12px] font-medium text-movexum-vit transition hover:bg-movexum-morklila"
          title="Stoppa inspelningen och transkribera"
          aria-label="Stoppa inspelningen och transkribera"
        >
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-movexum-vit"
            aria-hidden="true"
          />
          Spelar in {formatVoiceDuration(seconds)}
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
          title="Avbryt inspelningen"
          aria-label="Avbryt inspelningen"
        >
          <Icon name="x" size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled || phase === 'transcribing'}
      aria-label={phase === 'transcribing' ? 'Transkriberar inspelningen' : 'Tala i stället för att skriva'}
      title={
        phase === 'transcribing'
          ? 'Transkriberar…'
          : `Tala i stället för att skriva (Voxtral, Mistral EU · max ${Math.round(MAX_VOICE_SECONDS / 60)} min). Texten hamnar i rutan så du kan läsa igenom innan du skickar.`
      }
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {phase === 'transcribing' ? (
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-movexum-pastell-lila border-t-movexum-lila"
          aria-hidden="true"
        />
      ) : (
        <Icon name="mic" size={14} />
      )}
    </button>
  );
}
