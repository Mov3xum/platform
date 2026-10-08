import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReportSectionPatch, REPORT_SECTION_CONTENT_MAX } from './report-section';

test('vitlistade fält passerar, okända nycklar släpps', () => {
  const res = sanitizeReportSectionPatch({
    name: '  Analys ',
    state: 'review',
    content_md: '# Text',
    id: 'hijack',
    auto: false,
    evil: '<script>'
  });
  assert.deepEqual(res, { ok: true, patch: { name: 'Analys', state: 'review', content_md: '# Text' } });
});

test('ogiltig status och fel typer avvisas', () => {
  assert.equal(sanitizeReportSectionPatch({ state: 'published' }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ state: 1 }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ name: 5 }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ name: '   ' }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ content_md: { a: 1 } }).ok, false);
  assert.equal(sanitizeReportSectionPatch(null).ok, false);
  assert.equal(sanitizeReportSectionPatch([]).ok, false);
});

test('längdtak och tom uppdatering', () => {
  assert.equal(sanitizeReportSectionPatch({ content_md: 'x'.repeat(REPORT_SECTION_CONTENT_MAX + 1) }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ name: 'x'.repeat(201) }).ok, false);
  assert.equal(sanitizeReportSectionPatch({ auto: true }).ok, false);
});
