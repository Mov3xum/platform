import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyScreeningFacts, normalizeScreeningFacts, summarizeScreeningFacts } from './excellence-facts';

test('normalizeScreeningFacts: tomt/trasigt ger tomma svar utan undantag', () => {
  for (const raw of [null, undefined, 'x', 42, [], { companies: 'nej', founders: 'nej', irl: 5 }]) {
    const f = normalizeScreeningFacts(raw);
    assert.deepEqual(f.companies, {});
    assert.deepEqual(f.de_minimis_related, {});
    assert.ok(isEmptyScreeningFacts(f));
  }
});

test('normalizeScreeningFacts: org-nr normaliseras, okända punkter/värden släpps, personnummer saneras', () => {
  const f = normalizeScreeningFacts({
    comment: '  Granskat\r\n\r\n\r\nav controller 19900101-1234 ',
    companies: {
      '559572-8790': { listed: { verdict: 'yes', note: 'bolagsordning' }, dividend: { verdict: 'kanske' }, foo: { verdict: 'yes' } },
      'abc': { listed: { verdict: 'yes' } },
      '165594427808': { takeover: { verdict: 'no', note: 'ägare 850101-1234 köpte inkråm' } }
    },
    founders: [
      { name: ' Anna ', equity_pct: '55,5', engagement_pct: 120 },
      { name: '', equity_pct: 10 },
      { name: 'Bo', equity_pct: 20, engagement_pct: 40, researcher: true }
    ],
    maturity_phase: 'problem_solution_fit',
    research_spinoff: 'ja',
    not_market_ready: { verdict: 'yes' },
    excellence: { verdict: 'no', note: 'x'.repeat(2000) },
    de_minimis_related: { '5567036271': { used_eur: '12 345,6' }, '5567036272': { used_eur: -5 } },
    irl: { levels: { crl: 3, brl: 10, tmrl: '4' }, notes: { srl: 'Agenda 2030', foo: 'nej' } }
  });
  assert.equal(f.comment, 'Granskat\n\nav controller [REDACTED]');
  assert.deepEqual(Object.keys(f.companies).sort(), ['5594427808', '5595728790']);
  assert.deepEqual(f.companies['5595728790'], { listed: { verdict: 'yes', note: 'bolagsordning' } });
  assert.equal(f.companies['5594427808'].takeover?.note, 'ägare [REDACTED] köpte inkråm');
  assert.deepEqual(f.founders, [
    { name: 'Anna', equity_pct: 55.5 },
    { name: 'Bo', equity_pct: 20, engagement_pct: 40, researcher: true }
  ]);
  assert.equal(f.maturity_phase, 'problem_solution_fit');
  assert.equal(f.research_spinoff, undefined);
  assert.deepEqual(f.not_market_ready, { verdict: 'yes' });
  assert.equal(f.excellence?.note?.length, 600);
  assert.deepEqual(f.de_minimis_related, { '5567036271': { used_eur: 12346 } });
  assert.deepEqual(f.irl, { levels: { crl: 3, tmrl: 4 }, notes: { srl: 'Agenda 2030' } });
  assert.ok(!isEmptyScreeningFacts(f));
  const summary = summarizeScreeningFacts(f);
  assert.equal(summary.company_answers, 2);
  assert.equal(summary.founders, 2);
  assert.equal(summary.de_minimis_related, 1);
  assert.equal(summary.has_comment, true);
});

test('normalizeScreeningFacts: uppskattningar per bolag (bilaga I art. 4.3) normaliseras; tomma/ogiltiga släpps', () => {
  const f = normalizeScreeningFacts({
    estimates: {
      '559572-8790': { employees: '2,5', revenue_sek: '1 200 000', balance_sheet_sek: -5, note: 'budget 2026, pnr 19800101-1234' },
      '5594427808': { employees: 'x' },
      nonsense: { employees: 1 }
    }
  });
  assert.deepEqual(f.estimates, { '5595728790': { employees: 2.5, revenue_sek: 1_200_000, note: 'budget 2026, pnr [REDACTED]' } });
  assert.equal(isEmptyScreeningFacts(f), false);
  assert.equal(summarizeScreeningFacts(f).estimates, 1);
  assert.deepEqual(normalizeScreeningFacts({}).estimates, {});
});

test('normalizeScreeningFacts: manuellt angivna koncernbolag — org-nr normaliseras, enskild firma och dubbletter släpps, okända val får default', () => {
  const f = normalizeScreeningFacts({
    group_companies: [
      { org_nr: '559442-7808', name: 'Wellgo Health AB', relation: 'linked', direction: 'owner', share_pct: '100', note: 'aktieboken 2026-03, pnr 19800101-1234' },
      { org_nr: '5594427808', name: 'Dubblett' },
      { org_nr: '19800101-1234', name: 'Enskild firma', relation: 'linked' },
      { org_nr: '5567036271', relation: 'nonsense', direction: 'sideways', share_pct: 150 },
      'skräp',
      { name: 'utan org-nr' }
    ]
  });
  assert.equal(f.group_companies.length, 2);
  assert.deepEqual(f.group_companies[0], {
    org_nr: '5594427808',
    name: 'Wellgo Health AB',
    relation: 'linked',
    direction: 'owner',
    share_pct: 100,
    note: 'aktieboken 2026-03, pnr [REDACTED]'
  });
  assert.deepEqual(f.group_companies[1], { org_nr: '5567036271', relation: 'linked', direction: 'owner' });
  assert.equal(isEmptyScreeningFacts(f), false);
  assert.equal(summarizeScreeningFacts(f).group_companies, 2);
  assert.deepEqual(normalizeScreeningFacts({ group_companies: 'nej' }).group_companies, []);
});

test('person_links: bara giltiga org-nr och bedömningar, personnummer saneras', () => {
  const f = normalizeScreeningFacts({
    person_links: {
      '556703-6271': { verdict: 'not_linked', note: 'Annan marknad, ägare 19800101-1234' },
      '5590000006': { verdict: 'linked' },
      '8001011234': { verdict: 'linked' },
      '5560000001': { verdict: 'kanske' }
    }
  });
  assert.deepEqual(Object.keys(f.person_links ?? {}).sort(), ['5567036271', '5590000006']);
  assert.equal(f.person_links?.['5567036271'].verdict, 'not_linked');
  assert.ok(!f.person_links?.['5567036271'].note?.includes('19800101'));
  assert.equal(isEmptyScreeningFacts(normalizeScreeningFacts({ person_links: { '5590000006': { verdict: 'linked' } } })), false);
});
