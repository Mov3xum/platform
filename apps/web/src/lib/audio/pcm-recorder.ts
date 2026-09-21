/**
 * Kontinuerlig PCM-inspelning för mötesläget (CLAUDE.md § 34).
 *
 * VARFÖR inte MediaRecorder: mötet transkriberas i segment, och en
 * MediaRecorder måste STARTAS OM per segment (chunkar från `timeslice` är
 * inte självständigt avkodbara). Varje omstart tappade några hundra
 * millisekunder tal i skarven och klippte var 90:e sekund oavsett om någon
 * pratade mitt i ett ord. Här tas ljudet i stället som en obruten ström av
 * råa PCM-samples via Web Audio (ScriptProcessorNode — deprecerad men
 * universellt stödd, och den enda varianten som inte kräver en separat
 * worklet-fil under CSP:ns `strict-dynamic`), och `MeetingSegmenter`
 * (`@platform/shared`, ren + enhetstestad) väljer att klippa i en PAUS i
 * talet. Inga luckor, inga halva ord — och samma ström driver mikrofon-
 * mätaren, så det finns bara EN ljudväg att felsöka.
 *
 * Ljudet lever bara i minnet tills segmentet skickats (§ 34.2: ljud lagras
 * aldrig). Nivåmätningen är rent numerisk — ingen röstanalys (§ 31.4).
 *
 * Anroparen äger AudioContext:en (den MÅSTE skapas synkront i klick-
 * händelsen, annars blir den `suspended` av autoplay-policyn) och stänger
 * den efter `stop()`.
 */

import {
  MeetingSegmenter,
  concatFloat32,
  measureFloatLevel,
  type AudioLevel,
  type SegmentCutReason
} from '@platform/shared';

export interface PcmSegment {
  /** Ordningsnummer (0-baserat) — blir `segmentIndex` mot servern. */
  index: number;
  /** Mono-samples (−1..1) i kontextens samplingsfrekvens. */
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  /** Nivå över hela segmentet (topp/RMS). */
  level: AudioLevel;
  reason: SegmentCutReason | 'stop';
}

export interface PcmRecorderHandlers {
  /** Ett färdigt segment att koda och ladda upp. Anropas i inspelningsordning. */
  onSegment: (segment: PcmSegment) => void;
  /** Live-nivå för mikrofonmätaren (~var 150:e ms). */
  onLevel?: (level: AudioLevel) => void;
  /** Ett fel som gör att inspelningen inte kan fortsätta (svenskt meddelande). */
  onError?: (message: string) => void;
}

// 4096 samples ≈ 85 ms vid 48 kHz — kort nog för en snabb mätare och
// paus-detektering med ~100 ms upplösning, lång nog för låg CPU-last.
const PROCESSOR_BUFFER = 4096;
const LEVEL_EMIT_MS = 150;
// Får inget ljud in inom den här tiden är kontexten inte igång (autoplay-
// spärr, avkopplad enhet) — säg det i stället för att spela in tystnad.
const WATCHDOG_MS = 4000;
// Ett sista segment kortare än så (avslut mitt i en tystnad) har inget
// tal och laddas inte upp — ett sådant segment får inget index heller, så
// luck-markören sätts aldrig för det.
const MIN_FLUSH_SECONDS = 0.3;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Finns allt som behövs för kontinuerlig inspelning i den här webbläsaren? */
export function supportsPcmCapture(): boolean {
  const Ctor = audioContextCtor();
  if (!Ctor) return false;
  const proto = Ctor.prototype as Partial<AudioContext>;
  return (
    typeof proto.createScriptProcessor === 'function' &&
    typeof proto.createMediaStreamSource === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Skapar en AudioContext — anropa SYNKRONT i klick-händelsen. */
export function createCaptureContext(): AudioContext | null {
  try {
    const Ctor = audioContextCtor();
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export class PcmRecorder {
  private readonly ctx: AudioContext;
  private readonly stream: MediaStream;
  private readonly handlers: PcmRecorderHandlers;
  private readonly segmenter: MeetingSegmenter;

  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private peak = 0;
  private sumSquares = 0;
  private nextIndex = 0;
  private running = false;
  private gotAudio = false;
  private lastLevelEmit = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(
    ctx: AudioContext,
    stream: MediaStream,
    handlers: PcmRecorderHandlers,
    segmenter: MeetingSegmenter = new MeetingSegmenter()
  ) {
    this.ctx = ctx;
    this.stream = stream;
    this.handlers = handlers;
    this.segmenter = segmenter;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Sekunder fångade i det pågående (ännu inte klippta) segmentet. */
  get pendingSeconds(): number {
    return this.totalSamples / this.ctx.sampleRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.gotAudio = false;
    try {
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.processor = this.ctx.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
      // En ScriptProcessor bearbetar bara när den är kopplad mot
      // destinationen — via en tyst gain så att mikrofonen aldrig hörs i
      // högtalarna (rundgång).
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.processor.onaudioprocess = (event) => this.handleAudio(event);
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.ctx.destination);
    } catch {
      this.running = false;
      this.handlers.onError?.('Kunde inte koppla mikrofonen till ljudinspelningen.');
      return;
    }
    void this.ctx.resume().catch(() => undefined);
    this.watchdog = setTimeout(() => {
      if (this.running && !this.gotAudio) {
        this.handlers.onError?.(
          'Webbläsaren levererar inget ljud från mikrofonen — ljudkontexten startade inte. ' +
            'Avsluta och starta mötet igen (klicka direkt på knappen), eller ladda om sidan.'
        );
      }
    }, WATCHDOG_MS);
  }

  /** Stoppar inspelningen och levererar det sista segmentet (om det innehåller något). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.processor) this.processor.onaudioprocess = null;
    try {
      this.source?.disconnect();
      this.processor?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* redan bortkopplad */
    }
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.flush('stop');
  }

  private handleAudio(event: AudioProcessingEvent): void {
    if (!this.running) return;
    const input = event.inputBuffer.getChannelData(0);
    this.gotAudio = true;

    // Kopiera — webbläsaren återanvänder inbufferten mellan anropen.
    const block = new Float32Array(input.length);
    block.set(input);
    this.chunks.push(block);
    this.totalSamples += block.length;

    const level = measureFloatLevel(block);
    if (level.peak > this.peak) this.peak = level.peak;
    this.sumSquares += level.rms * level.rms * block.length;

    const now = Date.now();
    if (this.handlers.onLevel && now - this.lastLevelEmit >= LEVEL_EMIT_MS) {
      this.lastLevelEmit = now;
      this.handlers.onLevel(level);
    }

    const blockMs = (block.length / this.ctx.sampleRate) * 1000;
    const cut = this.segmenter.push(level.rms, blockMs);
    if (cut) this.flush(cut.reason);
  }

  private flush(reason: SegmentCutReason | 'stop'): void {
    const samples = concatFloat32(this.chunks, this.totalSamples);
    const seconds = samples.length / this.ctx.sampleRate;
    const level: AudioLevel = {
      peak: this.peak,
      rms: this.totalSamples > 0 ? Math.min(1, Math.sqrt(this.sumSquares / this.totalSamples)) : 0
    };
    this.chunks = [];
    this.totalSamples = 0;
    this.peak = 0;
    this.sumSquares = 0;
    // Segmenterarens index styr bara "kort första segment"-regeln; det index
    // servern ser räknas här och konsumeras BARA av segment som skickas.
    this.segmenter.next();
    if (seconds < MIN_FLUSH_SECONDS) return;
    const index = this.nextIndex++;
    this.handlers.onSegment({
      index,
      samples,
      sampleRate: this.ctx.sampleRate,
      seconds,
      level,
      reason
    });
  }
}
