import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadError, isDeployMismatchError } from './chunk-reload';

test('chunk-fel och föråldrade server actions räknas som deploy-glapp', () => {
  const stale = new Error('Server Action "6010ae0156754d67965cdd4a49fd33ff7a1d01c93b" was not found on the server.');
  stale.name = 'UnrecognizedActionError';
  assert.equal(isDeployMismatchError(stale), true);
  assert.equal(isDeployMismatchError(new Error('Loading chunk 123 failed.')), true);
  assert.equal(isChunkLoadError(stale), false);
});

test('vanliga fel laddar inte om sidan', () => {
  assert.equal(isDeployMismatchError(new Error('Roaring svarade HTTP 500.')), false);
  assert.equal(isDeployMismatchError(undefined), false);
});
