import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEETING_GAP_MARKER,
  MAX_MEETING_SEGMENTS,
  assembleMeetingTranscript,
  formatMeetingClock,
  isResumableMeetingStatus,
  isStaleMeeting,
  meetingTranscriptChars,
  normalizeMeetingSegments
} from './meeting';

test('normalizeMeetingSegments sorterar på index och dedupe:ar (sista vinner)', () => {
  const segments = normalizeMeetingSegments([
    { index: 2, text: 'tredje' },
    { index: 0, text: 'första (gammal)' },
    { index: 1, text: 'andra' },
    { index: 0, text: 'första (retry)' }
  ]);
  assert.deepEqual(
    segments.map((s) => s.text),
    ['första (retry)', 'andra', 'tredje']
  );
});

test('normalizeMeetingSegments filtrerar skräp och ogiltiga index', () => {
  const segments = normalizeMeetingSegments([
    null,
    'sträng',
    { index: -1, text: 'negativ' },
    { index: 1.5, text: 'decimal' },
    { index: MAX_MEETING_SEGMENTS + 1, text: 'över taket' },
    { index: 0, text: 'giltig' },
    { index: 3 } // saknad text → tom sträng (tystnad)
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, 'giltig');
  assert.equal(segments[1].text, '');
});

test('assembleMeetingTranscript fogar ihop text och normaliserar whitespace', () => {
  const text = assembleMeetingTranscript([
    { index: 0, text: '  Vi pratade om   nästa steg. ' },
    { index: 1, text: 'Beslut: ansöka till Vinnova.' }
  ]);
  assert.equal(text, 'Vi pratade om nästa steg. Beslut: ansöka till Vinnova.');
});

test('assembleMeetingTranscript markerar saknade segment som EN lucka per svit', () => {
  const text = assembleMeetingTranscript([
    { index: 0, text: 'Inledning.' },
    // index 1 + 2 saknas (uppladdning föll)
    { index: 3, text: 'Avslutning.' }
  ]);
  assert.equal(text, `Inledning.\n\n${MEETING_GAP_MARKER}\n\nAvslutning.`);
  assert.equal(text.split(MEETING_GAP_MARKER).length - 1, 1);
});

test('assembleMeetingTranscript hoppar tysta segment utan lucka-markör', () => {
  const text = assembleMeetingTranscript([
    { index: 0, text: 'Före tystnaden.' },
    { index: 1, text: '' }, // tystnad — inget fel
    { index: 2, text: 'Efter tystnaden.' }
  ]);
  assert.equal(text, 'Före tystnaden. Efter tystnaden.');
  assert.ok(!text.includes(MEETING_GAP_MARKER));
});

test('assembleMeetingTranscript prefixar talar-etikett när den finns', () => {
  const text = assembleMeetingTranscript([
    { index: 0, text: 'Hur går försäljningen?', speaker: 'Talare 1' },
    { index: 1, text: 'Bra — två nya kunder.', speaker: 'Talare 2' }
  ]);
  assert.equal(text, 'Talare 1: Hur går försäljningen? Talare 2: Bra — två nya kunder.');
});

test('assembleMeetingTranscript på tom input ger tom sträng', () => {
  assert.equal(assembleMeetingTranscript([]), '');
  assert.equal(assembleMeetingTranscript(undefined), '');
  assert.equal(assembleMeetingTranscript('skräp'), '');
});

test('meetingTranscriptChars summerar segmentens textlängd', () => {
  assert.equal(
    meetingTranscriptChars([
      { index: 0, text: 'abc' },
      { index: 1, text: 'de' }
    ]),
    5
  );
});

test('formatMeetingClock formaterar m:ss och h:mm:ss', () => {
  assert.equal(formatMeetingClock(0), '0:00');
  assert.equal(formatMeetingClock(65), '1:05');
  assert.equal(formatMeetingClock(3600), '1:00:00');
  assert.equal(formatMeetingClock(3725), '1:02:05');
  assert.equal(formatMeetingClock(-5), '0:00');
  assert.equal(formatMeetingClock(Number.NaN), '0:00');
});

test('isResumableMeetingStatus: recording/ended ja, saved/discarded nej', () => {
  assert.equal(isResumableMeetingStatus('recording'), true);
  assert.equal(isResumableMeetingStatus('ended'), true);
  assert.equal(isResumableMeetingStatus('saved'), false);
  assert.equal(isResumableMeetingStatus('discarded'), false);
  assert.equal(isResumableMeetingStatus(''), false);
});

test('isStaleMeeting: äldre än purge-fönstret ⇒ true, färsk/ogiltig ⇒ false', () => {
  const now = new Date('2026-09-02T12:00:00Z');
  assert.equal(isStaleMeeting('2026-08-20T12:00:00Z', now), true);
  assert.equal(isStaleMeeting('2026-09-01T12:00:00Z', now), false);
  assert.equal(isStaleMeeting(undefined, now), false);
  assert.equal(isStaleMeeting('inte-ett-datum', now), false);
});
