import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTACT_CATEGORIES,
  canDecideContactRequest,
  canWithdrawContactRequest,
  contactDedupeKey,
  contactDisplayName,
  contactRequestTransition,
  contactSubtitle,
  dedupeContactImportRows,
  isSelfApprovedRequest,
  mapContactImportHeaders,
  normalizeContactCategory,
  normalizeContactEmail,
  normalizePhone,
  parseContactImportRows,
  parseDelimitedText,
  splitFullName
} from './contacts.ts';

test('kategorier: fritext normaliseras till fast vokabulär', () => {
  assert.equal(normalizeContactCategory('Investerare'), 'investerare');
  assert.equal(normalizeContactCategory('VC-fond'), 'investerare');
  assert.equal(normalizeContactCategory('Jurist'), 'radgivare');
  assert.equal(normalizeContactCategory('Region Gävleborg'), 'myndighet');
  assert.equal(normalizeContactCategory('Högskolan i Gävle'), 'akademi');
  assert.equal(normalizeContactCategory('journalist'), 'media');
  assert.equal(normalizeContactCategory('något helt annat'), 'annan');
  assert.equal(normalizeContactCategory(''), null);
  assert.equal(normalizeContactCategory(42), null);
  for (const c of CONTACT_CATEGORIES) assert.equal(normalizeContactCategory(c), c);
});

test('visningsnamn och undertitel', () => {
  assert.equal(contactDisplayName({ first_name: ' Anna ', last_name: 'Andersson' }), 'Anna Andersson');
  assert.equal(contactDisplayName({ first_name: '', last_name: null }), 'Namnlös kontakt');
  assert.equal(contactSubtitle({ primary_role: 'VD', organization: 'Bolaget AB' }), 'VD, Bolaget AB');
  assert.equal(contactSubtitle({ primary_role: null, organization: 'Bolaget AB' }), 'Bolaget AB');
});

test('e-post och telefon normaliseras', () => {
  assert.equal(normalizeContactEmail(' Anna@Example.COM '), 'anna@example.com');
  assert.equal(normalizeContactEmail('inte-en-adress'), null);
  assert.equal(normalizeContactEmail(null), null);
  assert.equal(normalizePhone('070-123 45 67'), '0701234567');
  assert.equal(normalizePhone('0046 70 123 45 67'), '+46701234567');
  assert.equal(normalizePhone('123'), null);
});

test('dedupe-nyckel: e-post vinner, annars namn + organisation', () => {
  assert.equal(
    contactDedupeKey({ email: 'A@x.se', first_name: 'A', last_name: 'B' }),
    'email:a@x.se'
  );
  assert.equal(
    contactDedupeKey({ email: null, first_name: 'Anna', last_name: 'Andersson', organization: 'Bolaget' }),
    'name:anna andersson|bolaget'
  );
});

test('förfrågan: bara pending kan avgöras, och bara en gång', () => {
  assert.deepEqual(contactRequestTransition('pending', 'approved'), { ok: true });
  assert.deepEqual(contactRequestTransition('pending', 'declined'), { ok: true });
  assert.deepEqual(contactRequestTransition('pending', 'withdrawn'), { ok: true });
  assert.equal(contactRequestTransition('approved', 'declined').ok, false);
  assert.equal(contactRequestTransition('pending', 'pending').ok, false);
  assert.equal(contactRequestTransition('withdrawn', 'approved').ok, false);
});

test('behörighet: ägare eller admin/incubator_lead avgör; frågaren återkallar', () => {
  const ownerIds = ['u-owner'];
  assert.equal(canDecideContactRequest({ userId: 'u-owner', roles: ['mentor'], ownerIds }), true);
  assert.equal(canDecideContactRequest({ userId: 'u-other', roles: ['coach'], ownerIds }), false);
  assert.equal(canDecideContactRequest({ userId: 'u-other', roles: ['incubator_lead'], ownerIds }), true);
  assert.equal(canDecideContactRequest({ userId: 'u-other', roles: undefined, ownerIds }), false);
  assert.equal(canWithdrawContactRequest({ userId: 'u-req', roles: ['coach'], requesterId: 'u-req' }), true);
  assert.equal(canWithdrawContactRequest({ userId: 'u-x', roles: ['coach'], requesterId: 'u-req' }), false);
  assert.equal(canWithdrawContactRequest({ userId: 'u-x', roles: ['admin'], requesterId: 'u-req' }), true);
  assert.equal(isSelfApprovedRequest({ requesterId: 'u-owner', ownerIds }), true);
  assert.equal(isSelfApprovedRequest({ requesterId: 'u-x', ownerIds }), false);
});

test('CSV: auto-avgränsare, citat, dubblerade citattecken och radbrytning i cell', () => {
  const csv = 'Förnamn;Efternamn;E-post;Info\n"Anna";Andersson;anna@x.se;"Sa ""hej""\npå två rader"\nBo;;bo@y.se;\n\n';
  const rows = parseDelimitedText(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Förnamn', 'Efternamn', 'E-post', 'Info']);
  assert.deepEqual(rows[1], ['Anna', 'Andersson', 'anna@x.se', 'Sa "hej"\npå två rader']);
  assert.deepEqual(rows[2], ['Bo', '', 'bo@y.se', '']);
  // Komma-avgränsat + BOM
  const rows2 = parseDelimitedText('﻿first name,last name,email\r\nEva,Ek,eva@z.se\r\n');
  assert.deepEqual(rows2[1], ['Eva', 'Ek', 'eva@z.se']);
  assert.deepEqual(parseDelimitedText('   '), []);
});

test('rubriker mappas mot svenska/engelska/Outlook-alias, okända ignoreras', () => {
  assert.deepEqual(
    mapContactImportHeaders(['Förnamn', 'Last Name', 'E-mail Address', 'Company', 'Job Title', 'Ägare', 'Skostorlek']),
    ['first_name', 'last_name', 'email', 'organization', 'primary_role', 'owner_email', null]
  );
});

test('importrader: namn, e-post, kategori, samtycke, varningar utan PII', () => {
  const res = parseContactImportRows(
    ['Förnamn', 'Efternamn', 'E-post', 'Kategori', 'GDPR', 'Ägare', 'Okänd'],
    [
      ['anna', 'ANDERSSON', 'Anna@X.se', 'Investerare', 'ja', 'coach@movexum.se', 'x'],
      ['', '', '', '', '', '', ''],
      ['Bo Berg', '', 'bo@y.se', 'Region', 'nej', '', ''],
      ['', '', 'eva.ek@z.se', '', '', '', ''],
      ['Cid', 'Cek', 'inte en adress', '', '', '', '']
    ]
  );
  assert.deepEqual(res.unmappedHeaders, ['Okänd']);
  assert.equal(res.rows.length, 4);
  assert.equal(res.rows[0].first_name, 'Anna');
  assert.equal(res.rows[0].last_name, 'Andersson');
  assert.equal(res.rows[0].email, 'anna@x.se');
  assert.equal(res.rows[0].category, 'investerare');
  assert.equal(res.rows[0].gdpr_consent, true);
  assert.equal(res.rows[0].owner_email, 'coach@movexum.se');
  // Fullständigt namn i förnamnskolumnen delas
  assert.equal(res.rows[1].first_name, 'Bo');
  assert.equal(res.rows[1].last_name, 'Berg');
  assert.equal(res.rows[1].category, 'myndighet');
  assert.equal(res.rows[1].gdpr_consent, false);
  // Namn härlett ur e-post
  assert.equal(res.rows[2].first_name, 'Eva');
  assert.equal(res.rows[2].last_name, 'Ek');
  // Ogiltig e-post → tomt + varning
  assert.equal(res.rows[3].email, null);
  assert.ok(res.warnings.some((w) => w.startsWith('Rad 3:') && w.includes('hoppas över')));
  assert.ok(res.warnings.some((w) => w.startsWith('Rad 6:') && w.includes('ogiltig e-post')));
  // Varningar innehåller aldrig själva värdena (PII)
  assert.ok(!res.warnings.some((w) => w.includes('@')));
});

test('importrader utan namn-/e-postkolumn ger tydlig varning och inga rader', () => {
  const res = parseContactImportRows(['Skostorlek', 'Favoritfärg'], [['42', 'blå']]);
  assert.equal(res.rows.length, 0);
  assert.equal(res.warnings.length, 1);
});

test('dedupe av importrader slår ihop dubbletter och fyller tomma fält', () => {
  const base = parseContactImportRows(
    ['Förnamn', 'Efternamn', 'E-post', 'Organisation'],
    [
      ['Anna', 'Andersson', 'anna@x.se', ''],
      ['Anna', 'Andersson', 'ANNA@x.se', 'Bolaget AB'],
      ['Bo', 'Berg', '', 'Bolaget AB'],
      ['Bo', 'Berg', '', 'bolaget ab']
    ]
  );
  const { rows, merged } = dedupeContactImportRows(base.rows);
  assert.equal(merged, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].organization, 'Bolaget AB');
});

test('splitFullName', () => {
  assert.deepEqual(splitFullName('Anna Karin Andersson'), { first: 'Anna Karin', last: 'Andersson' });
  assert.deepEqual(splitFullName('Anna'), { first: 'Anna', last: '' });
  assert.deepEqual(splitFullName(''), { first: '', last: '' });
});
