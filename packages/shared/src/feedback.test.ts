import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  allowedFeedbackAreas,
  canDeleteFeedback,
  canEditFeedback,
  canTestFeedback,
  compareFeedbackItems,
  countFeedbackByStatus,
  defaultFeedbackTester,
  feedbackAreaLabel,
  feedbackAreaRoute,
  isFeedbackArea,
  isMyFeedback,
  normalizeFeedbackStatus,
  statusAfterFeedbackTest,
  testerAfterStatusChange,
  validateFeedbackAnswer,
  validateFeedbackInput,
  validateFeedbackTest
} from './feedback.ts';

test('områden: unika id:n, etikett och valfri route', () => {
  const ids = FEEDBACK_AREAS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(isFeedbackArea('rapporter'));
  assert.ok(isFeedbackArea('annat'));
  assert.equal(isFeedbackArea('finns-inte'), false);
  assert.equal(isFeedbackArea(42), false);
  assert.equal(feedbackAreaLabel('rapporter'), 'Rapportering');
  assert.equal(feedbackAreaRoute('rapporter'), '/rapporter');
  assert.equal(feedbackAreaRoute('mobil'), null);
  assert.equal(feedbackAreaLabel(null), 'Okänt område');
});

test('allowedFeedbackAreas: bara aktiverade moduler + modul-lösa områden', () => {
  const enabled = new Set(['hem', 'rapporter']);
  const ids = allowedFeedbackAreas((m) => enabled.has(m)).map((a) => a.id);
  assert.ok(ids.includes('hem'));
  assert.ok(ids.includes('rapporter'));
  assert.equal(ids.includes('arshjul'), false);
  // Tvärgående områden utan modul är alltid med.
  assert.ok(ids.includes('mobil'));
  assert.ok(ids.includes('inloggning'));
  assert.ok(ids.includes('annat'));
  // Ingen modul aktiverad ⇒ bara de modul-lösa.
  const none = allowedFeedbackAreas(() => false).map((a) => a.id);
  assert.deepEqual(none, FEEDBACK_AREAS.filter((a) => !a.module).map((a) => a.id));
  // Varje modul-kopplat område pekar på sitt eget id.
  for (const a of FEEDBACK_AREAS) if (a.module) assert.equal(a.module, a.id);
});

test('validering: rubrik, beskrivning, typ och område krävs', () => {
  const ok = validateFeedbackInput({
    title: '  Export till Excel  saknas ',
    description: 'Jag vill kunna exportera\r\nrapporten.',
    kind: 'feature',
    area: 'rapporter'
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.title, 'Export till Excel saknas');
    assert.equal(ok.value.description, 'Jag vill kunna exportera\nrapporten.');
  }
  assert.equal(validateFeedbackInput({ title: '', description: 'x', kind: 'bug', area: 'hem' }).ok, false);
  assert.equal(validateFeedbackInput({ title: 'x', description: '', kind: 'bug', area: 'hem' }).ok, false);
  assert.equal(validateFeedbackInput({ title: 'x', description: 'y', kind: 'wish', area: 'hem' }).ok, false);
  assert.equal(validateFeedbackInput({ title: 'x', description: 'y', kind: 'bug', area: 'nope' }).ok, false);
  assert.equal(validateFeedbackInput({ title: 'x'.repeat(161), description: 'y', kind: 'bug', area: 'hem' }).ok, false);
  for (const kind of FEEDBACK_KINDS) {
    assert.ok(validateFeedbackInput({ title: 't', description: 'd', kind, area: 'annat' }).ok);
  }
});

test('svar: tomt avvisas, whitespace trimmas', () => {
  assert.equal(validateFeedbackAnswer('   ').ok, false);
  const v = validateFeedbackAnswer('  Fixat i nästa release. ');
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value, 'Fixat i nästa release.');
});

test('behörighet: författare vs ledning', () => {
  const author = { id: 'u1', roles: ['coach'] as const };
  const other = { id: 'u2', roles: ['coach'] as const };
  const lead = { id: 'u3', roles: ['incubator_lead'] as const };
  const open = { author: 'u1', status: 'open' as const, answer: null };
  const answered = { author: 'u1', status: 'in_progress' as const, answer: 'Svar' };
  const done = { author: 'u1', status: 'done' as const, answer: 'Svar' };

  assert.ok(canEditFeedback(author, open));
  assert.ok(canEditFeedback(author, answered));
  assert.equal(canEditFeedback(author, done), false);
  assert.equal(canEditFeedback(other, open), false);
  assert.ok(canEditFeedback(lead, done));

  assert.ok(canDeleteFeedback(author, open));
  assert.equal(canDeleteFeedback(author, answered), false);
  assert.equal(canDeleteFeedback(other, open), false);
  assert.ok(canDeleteFeedback(lead, done));
});

test('sortering: öppna buggar först, klara sist, nyast först inom grupp', () => {
  const items = [
    { id: 'a', status: 'done', kind: 'bug', created: '2026-09-01' },
    { id: 'b', status: 'open', kind: 'feature', created: '2026-09-02' },
    { id: 'c', status: 'open', kind: 'bug', created: '2026-09-01' },
    { id: 'd', status: 'open', kind: 'bug', created: '2026-09-03' },
    { id: 'e', status: 'in_progress', kind: 'change', created: '2026-09-05' },
    { id: 'f', status: 'awaiting_feedback', kind: 'bug', created: '2026-09-06' }
  ] as const;
  const sorted = [...items].sort(compareFeedbackItems).map((i) => i.id);
  assert.deepEqual(sorted, ['d', 'c', 'b', 'e', 'f', 'a']);
  const counts = countFeedbackByStatus(items);
  assert.deepEqual(counts, { open: 3, in_progress: 1, awaiting_feedback: 1, done: 1 });
  for (const s of FEEDBACK_STATUSES) assert.ok(s in counts);
});

test('status: fyra steg, äldre "answered" tolkas som påbörjad', () => {
  assert.deepEqual([...FEEDBACK_STATUSES], ['open', 'in_progress', 'awaiting_feedback', 'done']);
  assert.equal(normalizeFeedbackStatus('answered'), 'in_progress');
  assert.equal(normalizeFeedbackStatus('awaiting_feedback'), 'awaiting_feedback');
  assert.equal(normalizeFeedbackStatus('nope'), 'open');
  assert.equal(normalizeFeedbackStatus(undefined), 'open');
});

test('testare: författaren pekas ut när kortet går till väntar återkoppling', () => {
  const noTester = { author: 'u1', tester: null };
  assert.equal(defaultFeedbackTester(noTester), 'u1');
  assert.equal(defaultFeedbackTester({ author: 'u1', tester: 'u9' }), 'u9');
  assert.equal(defaultFeedbackTester({ author: null, tester: null }), null);
  assert.equal(testerAfterStatusChange(noTester, 'awaiting_feedback'), 'u1');
  // Övriga statusbyten rör inte testaren.
  assert.equal(testerAfterStatusChange(noTester, 'in_progress'), null);
  assert.equal(testerAfterStatusChange({ author: 'u1', tester: 'u9' }, 'done'), 'u9');
  assert.ok(isMyFeedback({ author: 'u1', tester: null }, 'u1'));
  assert.ok(isMyFeedback({ author: 'u1', tester: 'u2' }, 'u2'));
  assert.equal(isMyFeedback({ author: 'u1', tester: 'u2' }, 'u3'), false);
});

test('testa: bara testaren eller ledningen, och bara i väntar återkoppling', () => {
  const tester = { id: 'u2', roles: ['coach'] as const };
  const other = { id: 'u3', roles: ['mentor'] as const };
  const lead = { id: 'u4', roles: ['admin'] as const };
  const waiting = { tester: 'u2', status: 'awaiting_feedback' as const };
  assert.ok(canTestFeedback(tester, waiting));
  assert.equal(canTestFeedback(other, waiting), false);
  assert.ok(canTestFeedback(lead, waiting));
  assert.equal(canTestFeedback(tester, { tester: 'u2', status: 'in_progress' }), false);
  assert.equal(canTestFeedback(tester, { tester: null, status: 'awaiting_feedback' }), false);
  assert.ok(canTestFeedback(lead, { tester: null, status: 'awaiting_feedback' }));
});

test('återkoppling: fungerar ⇒ klar, fungerar inte kräver not och ger påbörjad', () => {
  const ok = validateFeedbackTest({ result: 'ok', note: '  ' });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { result: 'ok', note: '' });
  assert.equal(validateFeedbackTest({ result: 'fail', note: '' }).ok, false);
  const fail = validateFeedbackTest({ result: 'fail', note: 'Knappen syns inte på mobil.\r\n' });
  assert.ok(fail.ok);
  if (fail.ok) assert.equal(fail.value.note, 'Knappen syns inte på mobil.');
  assert.equal(validateFeedbackTest({ result: 'maybe', note: 'x' }).ok, false);
  assert.equal(validateFeedbackTest({ result: 'ok', note: 'x'.repeat(2001) }).ok, false);
  assert.equal(statusAfterFeedbackTest('ok'), 'done');
  assert.equal(statusAfterFeedbackTest('fail'), 'in_progress');
});
