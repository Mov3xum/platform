import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_DENYLIST,
  PII_FIELD_PATTERNS,
  isDeniedCollection,
  autoMaskFields,
  maskRecord,
  deepMaskPII,
  fieldNameIsPII
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

test('de minimis-kollektionerna är denylistade (org.nr kan vara personnummer)', () => {
  for (const name of [
    'de_minimis_units',
    'de_minimis_unit_orgnr',
    'de_minimis_stod',
    'de_minimis_regelverk'
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

// --- Säkerhetsgranskning 2026-06 ---

test('denylist täcker web_cache, integration_providers och alla compass_*', () => {
  for (const name of [
    'web_cache',
    'integration_providers',
    'compass_lead_sources',
    'compass_modules',
    'compass_questions',
    'compass_messages',
    'compass_responses'
  ]) {
    assert.ok(isDeniedCollection(name), `${name} ska vara denylistad`);
  }
});

test('deepMaskPII tar bort PII-fält på ALLA djup (expand-bypass, H1)', () => {
  const item = {
    name: 'Acme AB',
    phase: 'idea',
    expand: {
      startup: {
        name: 'Acme AB',
        org_nr: '5566778899',
        founder_gender: 'kvinna',
        contact: { first_name: 'Anna', email: 'anna@acme.se', phone: '070-1' }
      },
      signups: [
        { name: 'Event', email: 'a@b.se', ip_hash: 'deadbeef' }
      ]
    }
  };
  const out = deepMaskPII(item) as Record<string, any>;
  // Topp-nivå ofarligt kvar.
  assert.equal(out.name, 'Acme AB');
  // Nästlade PII borta.
  assert.equal(out.expand.startup.org_nr, undefined);
  assert.equal(out.expand.startup.founder_gender, undefined);
  assert.equal(out.expand.startup.contact.email, undefined);
  assert.equal(out.expand.startup.contact.phone, undefined);
  assert.equal(out.expand.signups[0].email, undefined);
  assert.equal(out.expand.signups[0].ip_hash, undefined);
  // Ofarliga nästlade fält kvar.
  assert.equal(out.expand.startup.contact.first_name, 'Anna');
  assert.equal(out.expand.signups[0].name, 'Event');
});

test('deepMaskPII muterar inte indata', () => {
  const item = { expand: { u: { email: 'x@y.se' } } };
  deepMaskPII(item);
  assert.equal(item.expand.u.email, 'x@y.se');
});

test('fieldNameIsPII matchar substrings case-insensitivt', () => {
  assert.ok(fieldNameIsPII('Founder_Gender'));
  assert.ok(fieldNameIsPII('contact_email'));
  assert.ok(fieldNameIsPII('signer_ip_hash'));
  assert.ok(!fieldNameIsPII('name'));
  assert.ok(!fieldNameIsPII('phase'));
});
