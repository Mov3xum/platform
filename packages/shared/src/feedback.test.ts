import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  canDeleteFeedback,
  canEditFeedback,
  compareFeedbackItems,
  countFeedbackByStatus,
  feedbackAreaLabel,
  feedbackAreaRoute,
  isFeedbackArea,
  validateFeedbackAnswer,
  validateFeedbackInput
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
  const answered = { author: 'u1', status: 'answered' as const, answer: 'Svar' };
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
    { id: 'e', status: 'answered', kind: 'change', created: '2026-09-05' }
  ] as const;
  const sorted = [...items].sort(compareFeedbackItems).map((i) => i.id);
  assert.deepEqual(sorted, ['d', 'c', 'b', 'e', 'a']);
  const counts = countFeedbackByStatus(items);
  assert.deepEqual(counts, { open: 3, answered: 1, done: 1 });
  for (const s of FEEDBACK_STATUSES) assert.ok(s in counts);
});
