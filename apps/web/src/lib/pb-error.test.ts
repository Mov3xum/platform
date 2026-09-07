import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePbError, pbFieldCodes, pbFieldErrors, pbStatus } from './pb-error';

// Låser att PB:s fältdetaljer aldrig tappas bort bakom SDK:ns generiska
// "Failed to create record." (symtomet på /filer-uppladdningen).

function pbError(status: number, data: Record<string, unknown>, message = 'Failed to create record.') {
  const err = new Error(message) as Error & { status: number; response: { data: unknown } };
  err.status = status;
  err.response = { data };
  return err;
}

test('pbFieldErrors plockar message per fält ur response.data', () => {
  const err = pbError(400, { file: { code: 'validation_invalid_mime_type', message: 'Invalid mime type.' } });
  assert.deepEqual(pbFieldErrors(err), { file: 'Invalid mime type.' });
  assert.deepEqual(pbFieldCodes(err), { file: 'validation_invalid_mime_type' });
});

test('pbFieldErrors faller tillbaka på code när message saknas', () => {
  const err = pbError(400, { topic_status: { code: 'validation_invalid_value' } });
  assert.deepEqual(pbFieldErrors(err), { topic_status: 'validation_invalid_value' });
});

test('pbFieldErrors läser nästlad data.data (ClientResponseError-form)', () => {
  const err = new Error('Failed to create record.') as Error & { data: unknown };
  err.data = { data: { filename: { message: 'Cannot be blank.' } } };
  assert.deepEqual(pbFieldErrors(err), { filename: 'Cannot be blank.' });
});

test('pbFieldErrors tål fel utan data', () => {
  assert.deepEqual(pbFieldErrors(new Error('boom')), {});
  assert.deepEqual(pbFieldErrors(null), {});
  assert.deepEqual(pbFieldErrors('x'), {});
});

test('pbStatus returnerar HTTP-status bara när den är ett tal', () => {
  assert.equal(pbStatus(pbError(403, {})), 403);
  assert.equal(pbStatus(new Error('x')), undefined);
  assert.equal(pbStatus({ status: '400' }), undefined);
});

test('describePbError ersätter det generiska SDK-meddelandet och behåller fältdetaljer', () => {
  const err = pbError(400, { file: { message: 'Invalid mime type.' } });
  assert.equal(describePbError(err, 'Kunde inte ladda upp filen.'), 'Kunde inte ladda upp filen. (file: Invalid mime type.)');
});

test('describePbError behåller ett icke-generiskt meddelande', () => {
  const err = pbError(500, {}, 'connection refused');
  assert.equal(describePbError(err, 'Kunde inte ladda upp filen.'), 'connection refused');
});

test('describePbError ger bara fallback när inget finns att säga', () => {
  assert.equal(describePbError(pbError(400, {}), 'Kunde inte ladda upp filen.'), 'Kunde inte ladda upp filen.');
  assert.equal(describePbError(undefined, 'Fallback'), 'Fallback');
});
