import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAppPath, relativeRedirectInit, sanitizeAppPath } from './relative-redirect';

// Låser att route-handler-redirects är RELATIVA (löses mot den origin
// webbläsaren faktiskt anropade) — inte absoluta URL:er ur `request.url`, som
// i standalone-containern är bind-adressen http://0.0.0.0:3000 (incident
// 2026-09-30: "Logga ut" svarade 303 → http://0.0.0.0:3000/login och blockerades
// av CSP form-action 'self').

test('relativeRedirectInit ger 303 + relativ Location + no-store', () => {
  const init = relativeRedirectInit('/login');
  assert.equal(init.status, 303);
  assert.equal(init.headers.Location, '/login');
  assert.equal(init.headers['Cache-Control'], 'no-store');
  // Aldrig en absolut adress — den skulle bära containerns bind-host.
  assert.ok(!/^[a-z]+:\/\//i.test(init.headers.Location));
});

test('status kan väljas; sökväg med query bevaras', () => {
  const init = relativeRedirectInit('/integrationer?error=x%20y', 302);
  assert.equal(init.status, 302);
  assert.equal(init.headers.Location, '/integrationer?error=x%20y');
});

test('assertAppPath avvisar externa/protokollrelativa mål (open redirect)', () => {
  assert.equal(assertAppPath('/hem'), '/hem');
  assert.throws(() => assertAppPath('//evil.example/login'));
  assert.throws(() => assertAppPath('/\\evil.example'));
  assert.throws(() => assertAppPath('https://evil.example/'));
  assert.throws(() => assertAppPath('login'));
  assert.throws(() => assertAppPath(''));
  assert.throws(() => assertAppPath('/login\r\nSet-Cookie: x=y'));
});

test('sanitizeAppPath faller tillbaka i stället för att kasta', () => {
  assert.equal(sanitizeAppPath('/konto', '/dashboard'), '/konto');
  assert.equal(sanitizeAppPath('https://evil.example/', '/dashboard'), '/dashboard');
  assert.equal(sanitizeAppPath('//evil.example', '/dashboard'), '/dashboard');
  assert.equal(sanitizeAppPath(undefined, '/dashboard'), '/dashboard');
});
