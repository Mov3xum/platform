import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENT_CONTEXT_MAX_BYTES, parseAssessmentContext, serializeAssessmentContext, type AssessmentContext } from './context';

const ctx: AssessmentContext = {
  mode: 'register',
  providerName: 'Roaring',
  subject: { name: 'Combly AB', orgNr: '5595728790', startupId: 'abc123', bolagsform: 'Aktiebolag', registeredAt: '2024-03-10' },
  input: {
    subject: {
      orgNr: '5595728790',
      name: 'Combly AB',
      dataFetched: true,
      basic: { registeredAt: '2024-03-10', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' },
      financials: [{ year: 2025, employees: 2, revenue_sek: 100_000, dividend_sek: 0, dividend_reported: true }],
      ownership: [
        { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100, part: 'group_structure' },
        { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50, control_basis: 'shares' }
      ],
      groupStructureFetched: true,
      beneficialOwnersFetched: true
    },
    related: [
      {
        orgNr: '5594427808',
        name: 'Wellgo Health AB',
        dataFetched: true,
        basic: { registeredAt: '2024-01-01', bolagStatus: 'aktiv' },
        financials: [],
        ownership: [],
        groupStructureFetched: true,
        beneficialOwnersFetched: false,
        deMinimis: { usedEur: 20_000, source: 'platform' }
      }
    ],
    deMinimis: { usedEur: 10_000, capEur: 300_000 },
    irl: { level: 4, crl: 3, brl: null, tmrl: null, srl: null, assessedAt: '2026-01-01' },
    meetsExcellenceFlag: false,
    sekPerEur: 11.3
  },
  platformFounders: [{ name: 'Anna', equity_pct: 80 }],
  financialsByOrg: { '5595728790': [{ year: 2025, revenue_sek: 100_000 }] },
  notes: [{ orgNr: '5595728790', name: 'Combly AB', notes: ['Roaring grunddata (/se/company/overview/2.0) svarade med fälten: companyName'] }],
  lookupWarnings: [],
  cost: { companies: 2, parts: ['basic', 'financials'], calls: 4, credits: 90, sek: 18, unpricedParts: [], complete: true },
  assessedAt: '2026-10-12T10:00:00.000Z'
};

test('underlaget överlever rundturen oförändrat', () => {
  const parsed = parseAssessmentContext(serializeAssessmentContext(ctx));
  assert.deepEqual(parsed, ctx);
});

test('klientdata byggs om fält för fält: okända nycklar, personnamn på fysiska personer och ogiltiga värden släpps', () => {
  const raw = JSON.parse(serializeAssessmentContext(ctx));
  raw.subject.startupId = '../x';
  raw.subject.evil = 'x';
  raw.input.subject.ownership[1].name = 'Anna Andersson';
  raw.input.subject.ownership[1].org_nr = '195001011234';
  raw.input.subject.ownership[0].capital_pct = 140;
  raw.input.subject.financials[0].year = 'nej';
  raw.input.related[0].deMinimis.source = 'hacked';
  raw.input.sekPerEur = 11.3;
  raw.cost.parts = ['basic', 'nonsense'];
  raw.notes[0].notes.push(42, 'ok');
  const parsed = parseAssessmentContext(JSON.stringify(raw));
  assert.ok(parsed);
  assert.equal(parsed!.subject.startupId, undefined);
  assert.equal((parsed!.subject as unknown as Record<string, unknown>).evil, undefined);
  const person = parsed!.input.subject.ownership[1];
  assert.equal(person.name, undefined);
  assert.equal(person.org_nr, undefined);
  assert.equal(parsed!.input.subject.ownership[0].capital_pct, undefined);
  assert.deepEqual(parsed!.input.subject.financials, []);
  assert.equal(parsed!.input.related[0].deMinimis, undefined);
  assert.deepEqual(parsed!.cost?.parts, ['basic']);
  assert.deepEqual(parsed!.notes[0].notes.slice(-1), ['ok']);
});

test('ogiltigt eller för stort underlag ger null — aldrig ett undantag', () => {
  assert.equal(parseAssessmentContext(''), null);
  assert.equal(parseAssessmentContext('{'), null);
  assert.equal(parseAssessmentContext('[]'), null);
  assert.equal(parseAssessmentContext(JSON.stringify({ input: {}, subject: {} })), null);
  assert.equal(parseAssessmentContext(JSON.stringify({ ...ctx, input: { ...ctx.input, sekPerEur: 0 } })), null);
  assert.equal(parseAssessmentContext('x'.repeat(ASSESSMENT_CONTEXT_MAX_BYTES + 1)), null);
});
