/**
 * Segmentering av en kontinuerlig mötesinspelning (CLAUDE.md § 34) — ren,
 * IO-fri logik utan Web Audio-beroende, så att klippbesluten kan
 * ENHETSTESTAS mot syntetiska nivåsekvenser.
 *
 * VARFÖR: förut startades MediaRecorder om var 90:e sekund. Varje omstart
 * tappade några hundra millisekunder tal (stopp → ny encoder → start) och
 * klippet hamnade var det hamnade — ofta mitt i ett ord, som modellen då
 * hörde som två halva ord i två olika segment. Dedikerade transkriberings-
 * tjänster jobbar på hela filen och slipper skarvar helt. Vi kan inte lagra
 * ljudet (§ 34.2), men vi kan välja VAR skarven hamnar: klienten fångar
 * ljudet som en obruten PCM-ström och den här klassen letar efter en PAUS i
 * talet i fönstret [min, max] sekunder och klipper där — utan lucka, utan
 * halva ord. Nås taket utan paus klipps ändå (hård gräns, art. 15).
 *
 * Paus-detektering är rent numerisk (RMS mot en adaptiv brusnivå) — ingen
 * röstanalys, ingen identifiering (§ 31.4).
 */

import {
  MEETING_FIRST_SEGMENT_MIN_SECONDS,
  MEETING_FIRST_SEGMENT_SECONDS,
  MEETING_MIN_SEGMENT_SECONDS,
  MEETING_PAUSE_MS,
  MEETING_SEGMENT_SECONDS
} from './meeting';

export interface MeetingSegmenterOptions {
  /** Första segmentet: tidigaste klipp (i paus) respektive hårt tak, sekunder. */
  firstMinSeconds: number;
  firstMaxSeconds: number;
  /** Ordinarie segment: tidigaste klipp (i paus) respektive hårt tak, sekunder. */
  minSeconds: number;
  maxSeconds: number;
  /** Sammanhängande tystnad (ms) som räknas som paus. */
  pauseMs: number;
  /**
   * Absolut golv för "tyst" (RMS 0..1). Under det är ett block ALLTID tyst,
   * oavsett brusnivå. ≈ −40 dBFS: en öppen mikrofon i ett tyst rum ligger på
   * 0.001–0.005, tal på 0.02–0.2.
   */
  silenceRms: number;
  /** Faktor över den skattade brusnivån under vilken ett block räknas som paus. */
  noiseFactor: number;
  /** Tak för paus-tröskeln så att ett brusigt första block aldrig gör allt "tyst". */
  maxPauseRms: number;
}

export const DEFAULT_MEETING_SEGMENTER: MeetingSegmenterOptions = {
  firstMinSeconds: MEETING_FIRST_SEGMENT_MIN_SECONDS,
  firstMaxSeconds: MEETING_FIRST_SEGMENT_SECONDS,
  minSeconds: MEETING_MIN_SEGMENT_SECONDS,
  maxSeconds: MEETING_SEGMENT_SECONDS,
  pauseMs: MEETING_PAUSE_MS,
  silenceRms: 0.01,
  noiseFactor: 2.5,
  // ≈ −30 dBFS: även en lågmäld/avlägsen talare (RMS ~0.04) ligger ovanför.
  maxPauseRms: 0.03
};

export type SegmentCutReason = 'pause' | 'max';

export interface SegmentCut {
  reason: SegmentCutReason;
  /** Segmentets längd i sekunder vid klippet. */
  seconds: number;
  /** Segmentets ordningsnummer (0-baserat). */
  index: number;
}

/**
 * Matas med ett nivåblock i taget (`push`) och svarar med ett klippbeslut
 * när segmentet ska avslutas. Anroparen klipper då sin PCM-buffert och
 * anropar `next()` inför nästa segment. Brusnivån skattas löpande: den
 * följer snabbt nedåt (första riktiga pausen sätter golvet) och långsamt
 * uppåt (så att tal aldrig "blir" brus).
 */
export class MeetingSegmenter {
  private readonly opts: MeetingSegmenterOptions;
  private segmentIndex = 0;
  private elapsedMs = 0;
  private silentMs = 0;
  private noiseFloor: number;

  constructor(options: Partial<MeetingSegmenterOptions> = {}) {
    this.opts = { ...DEFAULT_MEETING_SEGMENTER, ...options };
    // Startgissning strax över golvet: ett första block med tal höjer den
    // långsamt, ett tyst block sänker den direkt.
    this.noiseFloor = this.opts.silenceRms;
  }

  /** Aktuellt segments ordningsnummer. */
  get index(): number {
    return this.segmentIndex;
  }

  /** Sekunder som hittills fångats i det aktuella segmentet. */
  get seconds(): number {
    return this.elapsedMs / 1000;
  }

  /** Paus-tröskeln just nu (för diagnostik/tester). */
  get pauseThreshold(): number {
    return Math.min(
      this.opts.maxPauseRms,
      Math.max(this.opts.silenceRms, this.noiseFloor * this.opts.noiseFactor)
    );
  }

  /**
   * Registrerar ett block med given RMS-nivå (0..1) och längd i ms. Returnerar
   * ett klippbeslut när segmentet ska avslutas, annars null.
   */
  push(rms: number, blockMs: number): SegmentCut | null {
    const level = Number.isFinite(rms) && rms > 0 ? Math.min(1, rms) : 0;
    const ms = Number.isFinite(blockMs) && blockMs > 0 ? blockMs : 0;
    this.elapsedMs += ms;

    // Adaptiv brusnivå: snabbt ned (första riktiga pausen sätter golvet),
    // MYCKET långsamt upp (tidskonstant ~3 min vid 100 ms-block) så att en
    // lång, oavbruten talsekvens inte lyfter golvet till talnivå — och
    // `maxPauseRms` cappar tröskeln oavsett.
    if (level < this.noiseFloor) {
      this.noiseFloor = level;
    } else {
      this.noiseFloor += (level - this.noiseFloor) * 0.0005;
    }

    const silent = level < this.pauseThreshold;
    this.silentMs = silent ? this.silentMs + ms : 0;

    const first = this.segmentIndex === 0;
    const minMs = (first ? this.opts.firstMinSeconds : this.opts.minSeconds) * 1000;
    const maxMs = (first ? this.opts.firstMaxSeconds : this.opts.maxSeconds) * 1000;

    if (this.elapsedMs >= maxMs) {
      return { reason: 'max', seconds: this.seconds, index: this.segmentIndex };
    }
    if (this.elapsedMs >= minMs && this.silentMs >= this.opts.pauseMs) {
      return { reason: 'pause', seconds: this.seconds, index: this.segmentIndex };
    }
    return null;
  }

  /** Påbörjar nästa segment (brusnivån behålls — den är rummets, inte segmentets). */
  next(): void {
    this.segmentIndex += 1;
    this.elapsedMs = 0;
    this.silentMs = 0;
  }
}
