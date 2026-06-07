import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_AGREEMENT_BYTES,
  validateAgreementFile,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_PARTY_LABELS,
  SIGNATURE_INTENT_TEXT
} from './agreements.ts';

test('accepts a valid PDF by mime', () => {
  assert.deepEqual(
    validateAgreementFile({ type: 'application/pdf', size: 1024, name: 'avtal.pdf' }),
    { ok: true }
  );
});

test('accepts a PDF by extension when mime is generic', () => {
  assert.deepEqual(
    validateAgreementFile({ type: 'application/octet-stream', size: 1024, name: 'avtal.pdf' }),
    { ok: true }
  );
});

test('rejects non-PDF files', () => {
  const res = validateAgreementFile({ type: 'image/png', size: 1024, name: 'logo.png' });
  assert.equal(res.ok, false);
});

test('rejects empty files', () => {
  const res = validateAgreementFile({ type: 'application/pdf', size: 0, name: 'a.pdf' });
  assert.equal(res.ok, false);
});

test('rejects files above the size cap', () => {
  const res = validateAgreementFile({
    type: 'application/pdf',
    size: MAX_AGREEMENT_BYTES + 1,
    name: 'big.pdf'
  });
  assert.equal(res.ok, false);
});

test('exposes labels for every status incl. partially_signed', () => {
  assert.equal(AGREEMENT_STATUS_LABELS.partially_signed, 'Delvis signerat');
  assert.equal(AGREEMENT_STATUS_LABELS.signed, 'Signerat');
});

test('party labels cover both signing parties', () => {
  assert.equal(AGREEMENT_PARTY_LABELS.company, 'Bolaget');
  assert.equal(AGREEMENT_PARTY_LABELS.movexum, 'Movexum');
});

test('intent text is a non-trivial binding statement', () => {
  assert.ok(SIGNATURE_INTENT_TEXT.length > 40);
});
