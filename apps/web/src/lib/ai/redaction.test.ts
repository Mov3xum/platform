import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_DENYLIST,
  PII_FIELD_PATTERNS,
  isDeniedCollection,
  autoMaskFields,
  maskRecord
} from './redaction';

// Dessa tester LÅSER PII-/åtkomstpolicyn för AI-chattens query-verktyg
// (CLAUDE.md § 9.3, § 10.2). Om någon av dem fallerar har en regression
// öppnat en väg för personuppgifter/känsliga kollektioner till modellen.

test('denylist håller ute auth-, PII- och credential-kollektioner', () => {
  for (const name of [
    'users',
    'tenants',
    'verification_tokens',
    'contacts', // extern-PII (§15.3)
    'agent_actions', // mutationsaudit
    'agent_memory', // tvärsessions-minne (§16.4)
    'tenant_integrations', // krypterade credentials
    'user_app_integrations',
    'user_mistral_connectors',
    'chat_threads', // privat innehåll (§17.2)
    'user_files',
    'deep_jobs'
  ]) {
    assert.equal(isDeniedCollection(name), true, `${name} ska vara denylistad`);
  }
});

test('alla compass_*-besökardatakollektioner är denylistade', () => {
  for (const name of [
    'compass_leads',
    'compass_conversations',
    'compass_messages',
    'compass_responses',
    'compass_security_events'
  ]) {
    assert.equal(isDeniedCollection(name), true, `${name} ska vara denylistad`);
  }
});

test('domänkollektioner som SKA vara läsbara är inte denylistade', () => {
  for (const name of ['startups', 'tool_runs', 'activities', 'startup_financials']) {
    assert.equal(isDeniedCollection(name), false, `${name} ska vara läsbar`);
  }
});

test('PII-mönstren täcker direkt-PII, GDPR art. 9 och pseudonym-PII', () => {
  for (const p of [
    'email',
    'phone',
    'personnummer',
    'person_nr',
    'password',
    'gender', // art. 9 — fångar founder_gender, founder_identifies_as via substring
    'identifies_as',
    'org_nr',
    'street_address',
    'postal_code',
    'ip_hash'
  ]) {
    assert.ok(PII_FIELD_PATTERNS.includes(p), `mönstret '${p}' saknas`);
  }
});

test('autoMaskFields maskar art. 9- och PII-fält (case-insensitive substring)', () => {
  const fields = [
    { name: 'name' },
    { name: 'phase' },
    { name: 'founder_gender' }, // art. 9
    { name: 'founder_identifies_as' }, // art. 9
    { name: 'contact_email' },
    { name: 'Phone' }, // versal → ska ändå fångas
    { name: 'org_nr' },
    { name: 'street_address' }
  ];
  const masked = autoMaskFields(fields);
  assert.deepEqual(
    masked.sort(),
    [
      'Phone',
      'contact_email',
      'founder_gender',
      'founder_identifies_as',
      'org_nr',
      'street_address'
    ].sort()
  );
  // Ofarliga fält maskas inte.
  assert.ok(!masked.includes('name'));
  assert.ok(!masked.includes('phase'));
});

test('maskRecord tar bort maskade fält men behåller resten', () => {
  const record = {
    name: 'Acme AB',
    founder_gender: 'kvinna',
    contact_email: 'a@b.se',
    phase: 'boost_chamber'
  };
  const out = maskRecord(record, { maskedFields: ['founder_gender', 'contact_email'] });
  assert.deepEqual(out, { name: 'Acme AB', phase: 'boost_chamber' });
  // Originalet muteras inte.
  assert.equal(record.founder_gender, 'kvinna');
});

test('maskRecord är no-op (samma referens) när inget ska maskas', () => {
  const record = { name: 'Acme AB' };
  const out = maskRecord(record, { maskedFields: [] });
  assert.equal(out, record);
});
