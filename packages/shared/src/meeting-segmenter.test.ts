import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEETING_SEGMENTER, MeetingSegmenter, type SegmentCut } from './meeting-segmenter';
import {
  MEETING_FIRST_SEGMENT_MIN_SECONDS,
  MEETING_FIRST_SEGMENT_SECONDS,
  MEETING_MIN_SEGMENT_SECONDS,
  MEETING_SEGMENT_SECONDS
} from './meeting';

// Låser klippbesluten för den kontinuerliga mötesinspelningen (CLAUDE.md § 34):
// klipp i en paus mellan min och max, hårt tak utan paus, kort första segment.

const BLOCK_MS = 100;
const SPEECH = 0.08; // typisk talnivå (RMS)
const ROOM = 0.002; // öppen mikrofon i ett tyst rum

/** Matar segmenteraren med `seconds` sekunder på nivån `rms`; returnerar första klippet. */
function feed(seg: MeetingSegmenter, rms: number, seconds: number): SegmentCut | null {
  const blocks = Math.round((seconds * 1000) / BLOCK_MS);
  for (let i = 0; i < blocks; i++) {
    const cut = seg.push(rms, BLOCK_MS);
    if (cut) return cut;
  }
  return null;
}

test('defaults speglar de delade möteskonstanterna', () => {
  assert.equal(DEFAULT_MEETING_SEGMENTER.firstMinSeconds, MEETING_FIRST_SEGMENT_MIN_SECONDS);
  assert.equal(DEFAULT_MEETING_SEGMENTER.firstMaxSeconds, MEETING_FIRST_SEGMENT_SECONDS);
  assert.equal(DEFAULT_MEETING_SEGMENTER.minSeconds, MEETING_MIN_SEGMENT_SECONDS);
  assert.equal(DEFAULT_MEETING_SEGMENTER.maxSeconds, MEETING_SEGMENT_SECONDS);
  assert.ok(DEFAULT_MEETING_SEGMENTER.firstMinSeconds < DEFAULT_MEETING_SEGMENTER.firstMaxSeconds);
  assert.ok(DEFAULT_MEETING_SEGMENTER.minSeconds < DEFAULT_MEETING_SEGMENTER.maxSeconds);
});

test('oavbrutet tal klipps vid det hårda taket (reason max)', () => {
  const seg = new MeetingSegmenter();
  seg.next(); // hoppa förbi det korta första segmentet
  const cut = feed(seg, SPEECH, 200);
  assert.ok(cut);
  assert.equal(cut.reason, 'max');
  assert.equal(cut.index, 1);
  assert.ok(Math.abs(cut.seconds - MEETING_SEGMENT_SECONDS) < 0.2);
});

test('en paus efter min-tiden ger klipp i pausen (reason pause), aldrig före min', () => {
  const seg = new MeetingSegmenter();
  seg.next();
  // 30 s tal, 2 s paus (före min → ingen klippning), 40 s tal, sedan paus.
  assert.equal(feed(seg, SPEECH, 30), null);
  assert.equal(feed(seg, ROOM, 2), null);
  assert.equal(feed(seg, SPEECH, 40), null);
  const cut = feed(seg, ROOM, 3);
  assert.ok(cut);
  assert.equal(cut.reason, 'pause');
  // Klipp ≈ 72 s + pausMs (500 ms), långt före taket på 90 s.
  assert.ok(cut.seconds > 72 && cut.seconds < 74, `klipp vid ${cut.seconds}s`);
});

test('en kort tvekan (< pauseMs) inne i en mening klipper inte', () => {
  const seg = new MeetingSegmenter();
  seg.next();
  assert.equal(feed(seg, SPEECH, 65), null);
  assert.equal(feed(seg, ROOM, 0.3), null); // 300 ms — ingen paus
  assert.equal(feed(seg, SPEECH, 5), null);
  assert.equal(seg.seconds > 70, true);
});

test('första segmentet är kort: paus ⇒ klipp tidigast efter firstMin, hårt tak firstMax', () => {
  const withPause = new MeetingSegmenter();
  assert.equal(feed(withPause, SPEECH, MEETING_FIRST_SEGMENT_MIN_SECONDS + 1), null);
  const cut = feed(withPause, ROOM, 2);
  assert.ok(cut);
  assert.equal(cut.reason, 'pause');
  assert.equal(cut.index, 0);
  assert.ok(cut.seconds < MEETING_FIRST_SEGMENT_SECONDS);

  const noPause = new MeetingSegmenter();
  const hard = feed(noPause, SPEECH, 60);
  assert.ok(hard);
  assert.equal(hard.reason, 'max');
  assert.ok(Math.abs(hard.seconds - MEETING_FIRST_SEGMENT_SECONDS) < 0.2);
});

test('ren tystnad (avstängd mikrofon) klipps vid min-tiden som paus — aldrig ett evigt segment', () => {
  const seg = new MeetingSegmenter();
  seg.next();
  const cut = feed(seg, 0, 200);
  assert.ok(cut);
  assert.equal(cut.reason, 'pause');
  assert.ok(Math.abs(cut.seconds - MEETING_MIN_SEGMENT_SECONDS) < 0.2);
});

test('brusigt rum: tröskeln anpassar sig så att brus räknas som paus men tal inte', () => {
  const seg = new MeetingSegmenter();
  seg.next();
  const NOISE = 0.012; // fläkt/ventilation strax över det absoluta golvet
  // Bruset ensamt sätter brusnivån → tröskeln hamnar ovanför bruset.
  assert.equal(feed(seg, NOISE, 5), null);
  assert.ok(seg.pauseThreshold > NOISE, `tröskel ${seg.pauseThreshold} ≤ brus ${NOISE}`);
  assert.ok(seg.pauseThreshold < SPEECH);
  // Tal höjer inte tröskeln över talnivån.
  assert.equal(feed(seg, SPEECH, 60), null);
  assert.ok(seg.pauseThreshold < SPEECH);
  // Tillbaka till bara brus = paus → klipp.
  const cut = feed(seg, NOISE, 3);
  assert.ok(cut);
  assert.equal(cut.reason, 'pause');
});

test('next() nollställer segmentet men behåller ordningsnummer och brusnivå', () => {
  const seg = new MeetingSegmenter();
  feed(seg, ROOM, 1); // sätter brusgolvet lågt
  const first = feed(seg, SPEECH, 60);
  assert.ok(first && first.index === 0);
  const threshold = seg.pauseThreshold;
  seg.next();
  assert.equal(seg.index, 1);
  assert.equal(seg.seconds, 0);
  assert.equal(seg.pauseThreshold, threshold);
});

test('en lång oavbruten talsekvens lyfter aldrig paus-tröskeln till talnivå', () => {
  const seg = new MeetingSegmenter();
  seg.next();
  feed(seg, ROOM, 1);
  // 90 s oavbrutet tal (klipps vid taket) — tröskeln ska ligga kvar långt under talet.
  const cut = feed(seg, SPEECH, 100);
  assert.ok(cut && cut.reason === 'max');
  assert.ok(seg.pauseThreshold <= DEFAULT_MEETING_SEGMENTER.maxPauseRms);
  assert.ok(seg.pauseThreshold < SPEECH / 2);
  // En lågmäld talare (hälften av nivån) räknas fortfarande som tal, inte paus.
  seg.next();
  assert.equal(feed(seg, SPEECH / 2, 65), null);
});

test('ogiltiga block (NaN/negativa) ignoreras utan att krascha', () => {
  const seg = new MeetingSegmenter();
  assert.equal(seg.push(Number.NaN, Number.NaN), null);
  assert.equal(seg.push(-1, -5), null);
  assert.equal(seg.seconds, 0);
});
