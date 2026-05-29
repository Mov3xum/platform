import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EDUCATION_DOCUMENT_BYTES,
  resolveEducationDocumentKind,
  validateEducationDocumentFile,
  educationDocumentKindLabels
} from './education-documents.ts';

// ── Kind-resolution (mime → doc_kind, med extensions-fallback) ────────────────

test('resolves pdf from mime', () => {
  assert.equal(resolveEducationDocumentKind('application/pdf'), 'pdf');
});

test('resolves modern Office mimes', () => {
  assert.equal(
    resolveEducationDocumentKind(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ),
    'excel'
  );
  assert.equal(
    resolveEducationDocumentKind(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ),
    'powerpoint'
  );
  assert.equal(
    resolveEducationDocumentKind(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ),
    'word'
  );
});

test('resolves legacy Office mimes', () => {
  assert.equal(resolveEducationDocumentKind('application/vnd.ms-excel'), 'excel');
  assert.equal(resolveEducationDocumentKind('application/vnd.ms-powerpoint'), 'powerpoint');
  assert.equal(resolveEducationDocumentKind('application/msword'), 'word');
});

test('falls back to file extension when mime is generic', () => {
  assert.equal(resolveEducationDocumentKind('application/octet-stream', 'plan.xlsx'), 'excel');
  assert.equal(resolveEducationDocumentKind('', 'deck.pptx'), 'powerpoint');
  assert.equal(resolveEducationDocumentKind('', 'avtal.docx'), 'word');
});

test('unknown type resolves to other', () => {
  assert.equal(resolveEducationDocumentKind('image/png', 'logo.png'), 'other');
});

// ── Validering ────────────────────────────────────────────────────────────────

test('accepts a valid pdf and returns its kind', () => {
  const result = validateEducationDocumentFile({ type: 'application/pdf', size: 1024, name: 'a.pdf' });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.docKind, 'pdf');
});

test('accepts an Office file by extension even with generic mime', () => {
  const result = validateEducationDocumentFile({
    type: 'application/octet-stream',
    size: 2048,
    name: 'budget.xlsx'
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.docKind, 'excel');
});

test('rejects an empty file', () => {
  const result = validateEducationDocumentFile({ type: 'application/pdf', size: 0, name: 'a.pdf' });
  assert.equal(result.ok, false);
});

test('rejects a file over the size limit', () => {
  const result = validateEducationDocumentFile({
    type: 'application/pdf',
    size: MAX_EDUCATION_DOCUMENT_BYTES + 1,
    name: 'big.pdf'
  });
  assert.equal(result.ok, false);
});

test('rejects a disallowed type (image)', () => {
  const result = validateEducationDocumentFile({ type: 'image/png', size: 1024, name: 'logo.png' });
  assert.equal(result.ok, false);
});

test('every kind has a label', () => {
  for (const kind of ['pdf', 'excel', 'powerpoint', 'word', 'other'] as const) {
    assert.equal(typeof educationDocumentKindLabels[kind], 'string');
  }
});
