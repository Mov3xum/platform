import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearedApprovalFields,
  contentChangedSinceApproval,
  isProtectedArtifactKey,
  reviewedContentHash,
  reviewedContentSnapshot,
  verifyCoachApproval
} from './workshop-review';

const answers = { q1: 'Vårt svar', da_chosen_scenario: 'Discovery' };
const artifacts = {
  diagnostic_output: 'Diagnos',
  diagnostic_run_id: 'run1',
  diagnostic_at: '2026-10-01T10:00:00Z',
  scenarios_output: 'Scenarier',
  ack_b1: true
};

test('skyddade nycklar känns igen', () => {
  assert.equal(isProtectedArtifactKey('coach_decision'), true);
  assert.equal(isProtectedArtifactKey('coach_approved_hash'), true);
  assert.equal(isProtectedArtifactKey('committed_at'), true);
  assert.equal(isProtectedArtifactKey('strategy_id'), true);
  assert.equal(isProtectedArtifactKey('document_url'), true);
  assert.equal(isProtectedArtifactKey('diagnostic_output'), false);
});

test('snapshot ignorerar nyckelordning, coach-fält och körningsmetadata', () => {
  const a = reviewedContentSnapshot(answers, artifacts);
  const b = reviewedContentSnapshot(
    { da_chosen_scenario: 'Discovery', q1: 'Vårt svar' },
    {
      scenarios_output: 'Scenarier',
      ack_b1: true,
      diagnostic_output: 'Diagnos',
      coach_decision: 'approved',
      coach_notes: 'Bra',
      diagnostic_run_id: 'run2'
    }
  );
  assert.equal(a, b);
  assert.equal(reviewedContentHash(answers, artifacts).length, 64);
});

test('godkännande med hash över samma innehåll är giltigt', () => {
  const hash = reviewedContentHash(answers, artifacts);
  const res = verifyCoachApproval(answers, { ...artifacts, coach_decision: 'approved', coach_approved_hash: hash });
  assert.deepEqual(res, { ok: true });
});

test('ändrat svar eller artefakt efter godkännande underkänns', () => {
  const hash = reviewedContentHash(answers, artifacts);
  const approved = { ...artifacts, coach_decision: 'approved', coach_approved_hash: hash };
  const r1 = verifyCoachApproval({ ...answers, q1: 'Annat' }, approved);
  assert.equal(r1.ok, false);
  assert.equal(r1.ok === false && r1.reason, 'changed');
  const r2 = verifyCoachApproval(answers, { ...approved, devils_advocate_output: 'Ny' });
  assert.equal(r2.ok === false && r2.reason, 'changed');
});

test('ej godkänt eller godkännande utan hash räknas inte', () => {
  const r1 = verifyCoachApproval(answers, { ...artifacts, coach_decision: 'returned' });
  assert.equal(r1.ok === false && r1.reason, 'not_approved');
  const r2 = verifyCoachApproval(answers, { ...artifacts, coach_decision: 'approved' });
  assert.equal(r2.ok === false && r2.reason, 'missing_hash');
});

test('contentChangedSinceApproval jämför mot hash, annars före/efter', () => {
  const hash = reviewedContentHash(answers, artifacts);
  const before = { answers, artifacts: { ...artifacts, coach_decision: 'approved', coach_approved_hash: hash } };
  // Oförändrad sparning (klientens kopia saknar körningsmetadata) → ingen ändring.
  assert.equal(
    contentChangedSinceApproval(before, {
      answers,
      artifacts: { diagnostic_output: 'Diagnos', scenarios_output: 'Scenarier', ack_b1: true }
    }),
    false
  );
  assert.equal(contentChangedSinceApproval(before, { answers: { ...answers, q1: 'x' }, artifacts }), true);
  const legacy = { answers, artifacts: { ...artifacts, coach_decision: 'approved' } };
  assert.equal(contentChangedSinceApproval(legacy, { answers, artifacts }), false);
  assert.equal(contentChangedSinceApproval(legacy, { answers, artifacts: { ...artifacts, scenarios_output: 'Nya' } }), true);
});

test('clearedApprovalFields nollställer beslut och hash', () => {
  const f = clearedApprovalFields('2026-10-08T00:00:00Z');
  assert.equal(f.coach_decision, null);
  assert.equal(f.coach_approved_hash, null);
});
