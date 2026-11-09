import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGING_PB_FALLBACK,
  describePbUrlSource,
  resolvePbEnvTarget,
  resolvePublicPbUrl,
  resolveServerPbUrl
} from './pb-url';

// Låser resolutionsordningen i CLAUDE.md § 7 och att MOVEXUM_ENV styr vilket
// _STAGING/_PRODUCTION-par som läses (incident 2026-09: produktion föll ner på
// en död staging-adress när env inte matchade).

test('MOVEXUM_ENV väljer produktion; osatt/okänt = staging', () => {
  assert.equal(resolvePbEnvTarget({ MOVEXUM_ENV: 'production' }), 'production');
  assert.equal(resolvePbEnvTarget({ MOVEXUM_ENV: ' Prod ' }), 'production');
  assert.equal(resolvePbEnvTarget({ MOVEXUM_ENV: 'staging' }), 'staging');
  assert.equal(resolvePbEnvTarget({}), 'staging');
  assert.equal(resolvePbEnvTarget({ MOVEXUM_ENV: 'live' }), 'staging');
});

test('produktion läser POCKETBASE_URL_PRODUCTION före allt annat', () => {
  const env = {
    NODE_ENV: 'production',
    MOVEXUM_ENV: 'production',
    POCKETBASE_URL_PRODUCTION: 'https://pb-app.movexum.se',
    POCKETBASE_URL_STAGING: 'https://pb-staging.app.movexum.se',
    NEXT_PUBLIC_POCKETBASE_URL: 'https://old.sslip.io'
  };
  assert.equal(resolveServerPbUrl(env), 'https://pb-app.movexum.se');
  assert.deepEqual(describePbUrlSource(env), { target: 'production', via: 'POCKETBASE_URL_PRODUCTION' });
});

test('utan MOVEXUM_ENV läses _STAGING-paret även om _PRODUCTION är satt', () => {
  const env = {
    NODE_ENV: 'production',
    POCKETBASE_URL_PRODUCTION: 'https://pb-app.movexum.se',
    POCKETBASE_URL_STAGING: 'https://pb-staging.app.movexum.se'
  };
  assert.equal(resolveServerPbUrl(env), 'https://pb-staging.app.movexum.se');
  assert.equal(describePbUrlSource(env).via, 'POCKETBASE_URL_STAGING');
});

test('produktion utan _PRODUCTION-var faller ner på den inbakade publika URL:en och sedan fallbacken', () => {
  const inlined = {
    NODE_ENV: 'production',
    MOVEXUM_ENV: 'production',
    NEXT_PUBLIC_POCKETBASE_URL: 'https://old.sslip.io'
  };
  assert.equal(resolveServerPbUrl(inlined), 'https://old.sslip.io');
  assert.equal(describePbUrlSource(inlined).via, 'NEXT_PUBLIC_POCKETBASE_URL');

  const bare = { NODE_ENV: 'production', MOVEXUM_ENV: 'production' };
  assert.equal(resolveServerPbUrl(bare), STAGING_PB_FALLBACK);
  assert.equal(describePbUrlSource(bare).via, 'fallback:STAGING_PB_FALLBACK');
});

test('compose-hostnamnet pocketbase:8080 ignoreras i produktion men inte lokalt', () => {
  const prod = { NODE_ENV: 'production', POCKETBASE_URL: 'http://pocketbase:8080' };
  assert.equal(resolveServerPbUrl(prod), STAGING_PB_FALLBACK);
  const dev = { NODE_ENV: 'development', POCKETBASE_URL: 'http://pocketbase:8080' };
  assert.equal(resolveServerPbUrl(dev), 'http://pocketbase:8080');
  assert.equal(resolveServerPbUrl({ NODE_ENV: 'development' }), 'http://localhost:8080');
});

test('publik URL: NEXT_PUBLIC-paret, annars server-URL:en', () => {
  assert.equal(
    resolvePublicPbUrl({ MOVEXUM_ENV: 'production', NEXT_PUBLIC_POCKETBASE_URL_PRODUCTION: 'https://pb-app.movexum.se' }),
    'https://pb-app.movexum.se'
  );
  assert.equal(
    resolvePublicPbUrl({ MOVEXUM_ENV: 'production', POCKETBASE_URL_PRODUCTION: 'https://pb-app.movexum.se' }),
    'https://pb-app.movexum.se'
  );
});
