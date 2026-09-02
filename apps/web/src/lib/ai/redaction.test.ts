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

// Policy 2026-06: bara grupp A (auth/hemligheter) + B (privat ägar-innehåll)
// är denylistade. Allt annat är läsbart, skyddat av RLS + fältmaskning.

test('denylist håller ute auth-, credential- och privat-innehåll-kollektioner', () => {
  for (const name of [
    // A. Auth, system & krypterade hemligheter
    'users',
    'tenants',
    'verification_tokens',
    'pending_signups',
    'tenant_integrations', // krypterade credentials
    'user_app_integrations',
    'user_mistral_connectors',
    // B. Strikt privat ägaren-bara-innehåll
    'chat_threads', // privat innehåll (§17.2)
    'user_files',
    'deep_jobs',
    'meeting_transcripts', // råa mötestranskript (§34)
    'agent_memory' // tvärsessions-minne (§16.4)
  ]) {
    assert.equal(isDeniedCollection(name), true, `${name} ska vara denylistad`);
  }
});

test('domändata är LÄSBAR (låstes upp 2026-06; skyddas av RLS + fältmaskning)', () => {
  for (const name of [
    // Kärndomän
    'startups',
    'tool_runs',
    'activities',
    'startup_financials',
    // C — tidigare denylistat, nu läsbart med fältmaskning
    'contacts',
    'compass_leads',
    'compass_conversations',
    'compass_messages',
    'compass_responses',
    'compass_security_events',
    'agent_actions',
    'agreement_signatures',
    // D — de minimis + onboarding
    'de_minimis_units',
    'de_minimis_unit_orgnr',
    'de_minimis_stod',
    'de_minimis_regelverk',
    'onboarding_flows',
    'onboarding_progress'
  ]) {
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
    'organisationsnummer', // utskrivet org-nr (de_minimis_unit_orgnr)
    'session_token', // compass-besökarsession
    'street_address',
    'postal_code',
    'ip_hash'
  ]) {
    assert.ok(PII_FIELD_PATTERNS.includes(p), `mönstret '${p}' saknas`);
  }
});

test('autoMaskFields maskar utskrivet org-nr, ip-hash och session-token', () => {
  const fields = [
    { name: 'belopp_sek' }, // de minimis-belopp — SKA synas (det vi vill åt)
    { name: 'stodgivare' }, // SKA synas
    { name: 'organisationsnummer' }, // enskild firma = personnummer → mask
    { name: 'visitor_ip_hash' }, // mask (ip_hash)
    { name: 'session_token' }, // mask (credential)
    { name: 'signer_email' } // mask (email)
  ];
  const masked = autoMaskFields(fields).sort();
  assert.deepEqual(masked, ['organisationsnummer', 'session_token', 'signer_email', 'visitor_ip_hash'].sort());
  assert.ok(!masked.includes('belopp_sek'));
  assert.ok(!masked.includes('stodgivare'));
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
