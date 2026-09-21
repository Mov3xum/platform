// Tester för .github/scripts/coolify-deploy.sh mot en lokal mock av
// Coolify-API:et. Körs i `yarn test` (node --test). Varje test startar en egen
// http-server, kör skriptet som en barnprocess med COOLIFY_* i env och
// asserterar exit-kod, loggutskrift och EXAKT vilka anrop som nådde servern —
// så att skriptet aldrig kan börja gissa andra origins igen (incident
// 2026-09-21, docs/incidents/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coolify-deploy.sh');

/**
 * Startar en mock-Coolify. `routes` mappar "METHOD /path?query" → svar eller
 * en lista av svar (ett per anrop, sista upprepas). Svar: { status, body }.
 */
async function startMock(routes) {
  const seen = [];
  const counters = new Map();
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    seen.push({ key, auth: req.headers.authorization ?? '' });
    let spec = routes[key];
    if (spec === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
      return;
    }
    if (Array.isArray(spec)) {
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      spec = spec[Math.min(n, spec.length - 1)];
    }
    res.writeHead(spec.status, { 'content-type': 'application/json' });
    res.end(typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function run(env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME ?? '/tmp',
        COOLIFY_TOKEN: 'test-token',
        COOLIFY_RETRY_DELAYS: '0 0',
        COOLIFY_CONNECT_TIMEOUT: '2',
        COOLIFY_MAX_TIME: '5',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const VERSION_OK = { status: 200, body: '"4.0.0-beta.999"' };
const DEPLOY_OK = { status: 200, body: { deployments: [{ message: 'Deployment queued.' }] } };
const UUID = 'abc123def456';

test('lyckad deploy: förkontroll + POST /api/v1/deploy, exit 0', async () => {
  const mock = await startMock({
    'GET /api/v1/version': VERSION_OK,
    [`POST /api/v1/deploy?uuid=${UUID}&force=false`]: DEPLOY_OK,
  });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl + '/', COOLIFY_APP_UUID: UUID, COOLIFY_TARGET_LABEL: 'staging' });
    assert.equal(code, 0, out);
    assert.match(out, /Coolify-deploy köad \(staging\)/);
    assert.deepEqual(mock.seen.map((s) => s.key), ['GET /api/v1/version', `POST /api/v1/deploy?uuid=${UUID}&force=false`]);
    assert.ok(mock.seen.every((s) => s.auth === 'Bearer test-token'));
  } finally {
    await mock.close();
  }
});

test('404 på v4-endpointen → äldre /applications/<uuid>/start används', async () => {
  const mock = await startMock({
    'GET /api/v1/version': VERSION_OK,
    [`POST /api/v1/applications/${UUID}/start?force=false`]: DEPLOY_OK,
  });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID });
    assert.equal(code, 0, out);
    assert.match(out, /provar äldre endpoint/);
    assert.deepEqual(mock.seen.map((s) => s.key), [
      'GET /api/v1/version',
      `POST /api/v1/deploy?uuid=${UUID}&force=false`,
      `POST /api/v1/applications/${UUID}/start?force=false`,
    ]);
  } finally {
    await mock.close();
  }
});

test('404 på båda endpointsen → exit 1 med UUID-diagnos', async () => {
  const mock = await startMock({ 'GET /api/v1/version': VERSION_OK });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID, COOLIFY_UUID_SECRET_NAME: 'COOLIFY_APP_UUID_STAGING' });
    assert.equal(code, 1);
    assert.match(out, /::error::Coolify svarade 404 på båda deploy-endpointsen.*COOLIFY_APP_UUID_STAGING/);
  } finally {
    await mock.close();
  }
});

test('övergående 500 → omförsök → lyckas', async () => {
  const mock = await startMock({
    'GET /api/v1/version': VERSION_OK,
    [`POST /api/v1/deploy?uuid=${UUID}&force=false`]: [
      { status: 500, body: { message: 'Server Error' } },
      { status: 503, body: { message: 'restarting' } },
      DEPLOY_OK,
    ],
  });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID });
    assert.equal(code, 0, out);
    assert.match(out, /HTTP 500 \(försök 1\/3\)/);
    assert.match(out, /HTTP 503 \(försök 2\/3\)/);
    assert.equal(mock.seen.filter((s) => s.key.startsWith('POST /api/v1/deploy')).length, 3);
  } finally {
    await mock.close();
  }
});

test('ihållande 500 → exit 1 med "trasig internt"-diagnos, inga andra origins provas', async () => {
  const mock = await startMock({
    'GET /api/v1/version': { status: 500, body: { message: 'Server Error' } },
  });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID });
    assert.equal(code, 1);
    assert.match(out, /::error::Coolify på 127\.0\.0\.1:\d+ svarar men returnerar HTTP 500\. Coolify-instansen är trasig internt/);
    assert.equal(mock.seen.length, 3, 'exakt 1 + 2 omförsök på förkontrollen');
    assert.ok(mock.seen.every((s) => s.key === 'GET /api/v1/version'));
  } finally {
    await mock.close();
  }
});

test('Coolify nere (connection refused) → exit 1 med infrastrukturdiagnos', async () => {
  // Reservera en port och stäng den igen så att inget lyssnar där.
  const probe = await startMock({});
  const deadUrl = probe.baseUrl;
  await probe.close();
  const { code, out } = await run({ COOLIFY_BASE_URL: deadUrl, COOLIFY_APP_UUID: UUID });
  assert.equal(code, 1);
  assert.match(out, /kunde inte nå Coolify \(försök 1\/3\)/);
  assert.match(out, /::error::Coolify på 127\.0\.0\.1:\d+ svarar inte alls .*INFRASTRUKTURFEL/);
  assert.match(out, /docker ps --filter name=coolify/);
  assert.match(out, /uppdatera GitHub-secreten COOLIFY_BASE_URL/);
});

test('401 på förkontrollen → token-fel, deploy-anropet görs aldrig', async () => {
  const mock = await startMock({ 'GET /api/v1/version': { status: 401, body: { message: 'Unauthenticated.' } } });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID });
    assert.equal(code, 1);
    assert.match(out, /::error::Coolify avvisade API-tokenen \(HTTP 401/);
    assert.deepEqual(mock.seen.map((s) => s.key), ['GET /api/v1/version']);
  } finally {
    await mock.close();
  }
});

test('äldre Coolify utan /api/v1/version → varning, deployen fortsätter', async () => {
  const mock = await startMock({ [`POST /api/v1/deploy?uuid=${UUID}&force=true`]: DEPLOY_OK });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID, COOLIFY_FORCE: 'true' });
    assert.equal(code, 0, out);
    assert.match(out, /::warning::Coolify svarar men \/api\/v1\/version saknas/);
  } finally {
    await mock.close();
  }
});

test('tag-deploy: ?tag=… url-kodat, ingen legacy-fallback vid 404', async () => {
  const mock = await startMock({ 'GET /api/v1/version': VERSION_OK });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: 'tag:staging' });
    assert.equal(code, 1);
    assert.match(out, /::error::Coolify svarade 404 på tag-deployen/);
    assert.deepEqual(mock.seen.map((s) => s.key), ['GET /api/v1/version', 'POST /api/v1/deploy?tag=tag%3Astaging&force=false']);
  } finally {
    await mock.close();
  }
});

test('webhook-URL vinner över UUID och kräver ingen förkontroll', async () => {
  const mock = await startMock({ 'POST /webhooks/deploy/xyz?force=false': DEPLOY_OK });
  try {
    const { code, out } = await run({
      COOLIFY_DEPLOY_WEBHOOK: `${mock.baseUrl}/webhooks/deploy/xyz?force=false`,
      COOLIFY_BASE_URL: 'http://192.0.2.1:8000',
      COOLIFY_APP_UUID: UUID,
    });
    assert.equal(code, 0, out);
    assert.match(out, /köad via webhook/);
    assert.deepEqual(mock.seen.map((s) => s.key), ['POST /webhooks/deploy/xyz?force=false']);
  } finally {
    await mock.close();
  }
});

test('saknad UUID: fel som default, varning + exit 0 i sync-läge', async () => {
  const strict = await run({ COOLIFY_BASE_URL: 'http://127.0.0.1:1', COOLIFY_UUID_SECRET_NAME: 'COOLIFY_APP_UUID_STAGING' });
  assert.equal(strict.code, 1);
  assert.match(strict.out, /::error::.*COOLIFY_APP_UUID_STAGING/);

  const lenient = await run({ COOLIFY_BASE_URL: 'http://127.0.0.1:1', COOLIFY_MISSING_UUID_IS_WARNING: 'true' });
  assert.equal(lenient.code, 0);
  assert.match(lenient.out, /::warning::.*Hoppar över Coolify-redeploy/);
});

test('konfigurationsfel: token/base-URL saknas eller saknar schema', async () => {
  const noToken = await run({ COOLIFY_TOKEN: '', COOLIFY_BASE_URL: 'http://127.0.0.1:1', COOLIFY_APP_UUID: UUID });
  assert.equal(noToken.code, 1);
  assert.match(noToken.out, /::error::COOLIFY_TOKEN saknas/);

  const noBase = await run({ COOLIFY_BASE_URL: '', COOLIFY_APP_UUID: UUID });
  assert.equal(noBase.code, 1);
  assert.match(noBase.out, /::error::COOLIFY_BASE_URL saknas/);

  const noScheme = await run({ COOLIFY_BASE_URL: '212.0.2.1:8000', COOLIFY_APP_UUID: UUID });
  assert.equal(noScheme.code, 1);
  assert.match(noScheme.out, /måste börja med https:\/\/ eller http:\/\//);
});

test('http:// ger en klartextvarning men blockerar inte', async () => {
  const mock = await startMock({
    'GET /api/v1/version': VERSION_OK,
    [`POST /api/v1/deploy?uuid=${UUID}&force=false`]: DEPLOY_OK,
  });
  try {
    const { code, out } = await run({ COOLIFY_BASE_URL: mock.baseUrl, COOLIFY_APP_UUID: UUID });
    assert.equal(code, 0, out);
    assert.match(out, /::warning::COOLIFY_BASE_URL använder http:\/\//);
  } finally {
    await mock.close();
  }
});
