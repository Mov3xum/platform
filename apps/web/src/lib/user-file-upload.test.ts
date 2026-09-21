import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeUserFileCreateError,
  resolveUploadMime,
  validateUserFileUpload,
  USER_FILE_MAX_BYTES
} from './user-file-upload';

// Låser förvalideringen av /filer-uppladdningar (CLAUDE.md § 17/§ 24) så att
// mime-listan/taket speglar migration 1700000085 och feltexterna är åtgärdbara.

test('resolveUploadMime använder webbläsarens typ när den är känd', () => {
  assert.equal(resolveUploadMime('application/pdf', 'rapport.pdf'), 'application/pdf');
  assert.equal(resolveUploadMime('IMAGE/PNG', 'bild.png'), 'image/png');
});

test('resolveUploadMime strippar parametrar', () => {
  assert.equal(resolveUploadMime('text/plain; charset=utf-8', 'a.txt'), 'text/plain');
});

test('resolveUploadMime härleder ur ändelsen när typen saknas (Windows .md)', () => {
  assert.equal(resolveUploadMime('', 'anteckningar.md'), 'text/markdown');
  assert.equal(resolveUploadMime(undefined, 'deck.PPTX'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(resolveUploadMime('application/octet-stream', 'x.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('resolveUploadMime låter .csv vinna över Excel-märkningen', () => {
  assert.equal(resolveUploadMime('application/vnd.ms-excel', 'data.csv'), 'text/csv');
});

test('resolveUploadMime ger tomt när inget kan härledas', () => {
  assert.equal(resolveUploadMime('', 'okänd.zzz'), '');
  assert.equal(resolveUploadMime('', 'utanändelse'), '');
});

test('validateUserFileUpload accepterar tillåtna filer och sätter doc_kind', () => {
  const r = validateUserFileUpload({ name: 'q1.xlsx', size: 1234, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.docKind, 'xlsx');
    assert.equal(r.filename, 'q1.xlsx');
  }
  const png = validateUserFileUpload({ name: 'bild.png', size: 10, type: 'image/png' });
  assert.ok(png.ok && png.docKind === 'other');
});

test('validateUserFileUpload avvisar tomma, för stora och otillåtna filer', () => {
  assert.deepEqual(validateUserFileUpload({ name: 'a.pdf', size: 0, type: 'application/pdf' }), { ok: false, error: 'Filen är tom.' });
  const big = validateUserFileUpload({ name: 'a.pdf', size: USER_FILE_MAX_BYTES + 1, type: 'application/pdf' });
  assert.ok(!big.ok && big.error === 'Filen är större än 25 MB.');
  const exe = validateUserFileUpload({ name: 'setup.exe', size: 10, type: 'application/x-msdownload' });
  assert.ok(!exe.ok && /stöds inte/.test(exe.error));
  const unknown = validateUserFileUpload({ name: 'blob', size: 10, type: '' });
  assert.ok(!unknown.ok && /okänt/.test(unknown.error));
});

test('validateUserFileUpload cappar filnamnet till 255 tecken', () => {
  const r = validateUserFileUpload({ name: `${'a'.repeat(300)}.pdf`, size: 10, type: 'application/pdf' });
  assert.ok(r.ok && r.filename.length === 255);
});

function pbError(data: Record<string, unknown>) {
  const err = new Error('Failed to create record.') as Error & { status: number; response: { data: unknown } };
  err.status = 400;
  err.response = { data };
  return err;
}

test('describeUserFileCreateError översätter PB:s mime-avvisning', () => {
  const msg = describeUserFileCreateError(pbError({ file: { code: 'validation_invalid_mime_type', message: 'Invalid mime type.' } }));
  assert.match(msg, /innehåll matchar inte/);
});

test('describeUserFileCreateError översätter storleksfel', () => {
  const msg = describeUserFileCreateError(pbError({ file: { code: 'validation_file_size_limit', message: 'Failed to upload all files.' } }));
  assert.equal(msg, 'Filen är större än 25 MB.');
});

test('describeUserFileCreateError behåller övriga fältdetaljer', () => {
  const msg = describeUserFileCreateError(pbError({ topic_status: { code: 'validation_invalid_value', message: 'Invalid value.' } }));
  assert.equal(msg, 'Kunde inte ladda upp filen. (topic_status: Invalid value.)');
});

test('describeUserFileCreateError ger svensk fallback för det generiska SDK-felet', () => {
  assert.equal(describeUserFileCreateError(pbError({})), 'Kunde inte ladda upp filen.');
});
