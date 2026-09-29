import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPbProbe, describeLoginInfraError, summarizeNetworkError } from './pb-health';

// Låser att ett 404 från PB-SDK:n aldrig igen rapporteras som "users saknas"
// när adressen i själva verket inte routas till PocketBase (incident 2026-09).

test('PocketBases health-JSON klassas som pocketbase', () => {
  const r = classifyPbProbe({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"code":200,"message":"API is healthy.","data":{"canBackup":true}}'
  });
  assert.equal(r.kind, 'pocketbase');
  assert.match(describeLoginInfraError('https://pb.example', r), /Users-collectionen saknas/);
});

test('Traefiks "404 page not found" klassas som proxy_404 med Coolify-hint', () => {
  const r = classifyPbProbe({ status: 404, contentType: 'text/plain; charset=utf-8', body: '404 page not found\n' });
  assert.equal(r.kind, 'proxy_404');
  const msg = describeLoginInfraError('https://pb-app.movexum.se', r);
  assert.match(msg, /routas inte till PocketBase/);
  assert.match(msg, /Domains på PocketBase-resursen/);
  assert.doesNotMatch(msg, /migrationerna/);
});

test('HTML-svar (web-appen / annan tjänst) klassas som html oavsett status', () => {
  const html = '<!DOCTYPE html><html lang="sv"><head><title>Movexum</title></head><body></body></html>';
  assert.equal(classifyPbProbe({ status: 404, contentType: 'text/html', body: html }).kind, 'html');
  assert.equal(classifyPbProbe({ status: 200, contentType: 'text/html; charset=utf-8', body: html }).kind, 'html');
  assert.equal(classifyPbProbe({ status: 200, contentType: null, body: '  <html><body>x</body></html>' }).kind, 'html');
  assert.match(describeLoginInfraError('https://x', { kind: 'html', status: 200 }), /HTML-sida/);
});

test('5xx klassas som error_status', () => {
  const r = classifyPbProbe({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' });
  assert.equal(r.kind, 'error_status');
  assert.match(describeLoginInfraError('https://x', r), /HTTP 503/);
});

test('200 utan PB:s health-JSON klassas som not_pocketbase', () => {
  const r = classifyPbProbe({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  assert.equal(r.kind, 'not_pocketbase');
  assert.equal(classifyPbProbe({ status: 404, contentType: 'application/json', body: '{"code":404}' }).kind, 'not_pocketbase');
});

test('summarizeNetworkError ger kort, loggbar orsak', () => {
  const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND pb' } });
  assert.equal(summarizeNetworkError(err), 'ENOTFOUND: getaddrinfo ENOTFOUND pb');
  const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  assert.match(summarizeNetworkError(abort), /timeout/);
  assert.equal(summarizeNetworkError(undefined), 'okänt nätverksfel');
  assert.match(describeLoginInfraError('https://x', { kind: 'unreachable', reason: 'ENOTFOUND' }), /ENOTFOUND/);
});
