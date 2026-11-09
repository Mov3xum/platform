import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenExcellence, type ExcellenceScreeningInput, type GroupCompanyFacts } from './excellence-screening';
import { normalizeScreeningFacts } from './excellence-facts';
import { diffScreeningRuns, normalizeScreeningRunSummary, screeningRunHeadline, summarizeScreeningRun } from './excellence-history';

const REF = new Date('2026-10-13T00:00:00Z');

function company(over: Partial<GroupCompanyFacts> & { orgNr: string }): GroupCompanyFacts {
  return {
    name: over.name,
    dataFetched: true,
    basic: { registeredAt: '2026-02-17', bolagStatus: 'aktiv', bolagsform: 'AB' },
    financials: [],
    ownership: [],
    groupStructureFetched: true,
    beneficialOwnersFetched: true,
    ...over
  };
}

function input(over: Partial<ExcellenceScreeningInput> = {}): ExcellenceScreeningInput {
  return {
    refDate: REF,
    subject: company({ orgNr: '5595728790', name: 'Combly AB' }),
    related: [],
    deMinimis: { usedEur: 0, capEur: 300000 },
    irl: null,
    meetsExcellenceFlag: false,
    sekPerEur: 11.3,
    ...over
  };
}

test('summarizeScreeningRun: kompakt, utan detail; räknar ja/nej/okänt; round-trip via normalize', () => {
  const result = screenExcellence(input());
  const s = summarizeScreeningRun(result, { cost: { credits: 245, sek: 49, complete: true } });
  assert.equal(s.version, 1);
  assert.equal(s.state_aid, result.stateAid.outcome);
  assert.equal(s.vinnova, result.vinnova.outcome);
  assert.equal(s.counts.yes + s.counts.no + s.counts.unknown, result.checks.length);
  assert.ok(s.checks.every((c) => !('detail' in c)));
  assert.ok(s.checks.some((c) => c.scope === '5595728790' && c.id === 'age'));
  assert.ok(s.checks.some((c) => c.scope === '' && c.id === 'de_minimis'));
  assert.deepEqual(s.companies, [{ org_nr: '5595728790', name: 'Combly AB', role: 'subject' }]);
  assert.deepEqual(s.cost, { credits: 245, sek: 49, complete: true });
  const back = normalizeScreeningRunSummary(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.ok(screeningRunHeadline(s).includes('okänt'));
});

test('normalizeScreeningRunSummary: trasig json ger null eller tolererade fält', () => {
  assert.equal(normalizeScreeningRunSummary(null), null);
  assert.equal(normalizeScreeningRunSummary({ state_aid: 'x' }), null);
  const s = normalizeScreeningRunSummary({
    state_aid: 'de_minimis',
    vinnova: 'undetermined',
    excellence: 'unknown',
    checks: [{ scope: '', id: 'a', verdict: 'yes', source: 'register' }, { id: 'b', verdict: 'nope', source: 'register' }, 'x'],
    companies: [{ org_nr: '5595728790', role: 'subject' }, { role: 'subject' }],
    missing: ['a', 3],
    thresholds: { employees: 'två' }
  });
  assert.ok(s);
  assert.equal(s!.checks.length, 1);
  assert.deepEqual(s!.counts, { yes: 1, no: 0, unknown: 0 });
  assert.equal(s!.companies.length, 1);
  assert.deepEqual(s!.missing, ['a']);
  assert.equal(s!.thresholds.employees, undefined);
  assert.equal(s!.thresholds.complete, false);
});

test('diffScreeningRuns: utfall, punkter, saknat underlag, koncernbolag och tröskel', () => {
  const before = summarizeScreeningRun(screenExcellence(input()));
  const after = summarizeScreeningRun(
    screenExcellence(
      input({
        subject: company({
          orgNr: '5595728790',
          name: 'Combly AB',
          financials: [{ year: 2025, employees: 2, revenue_sek: 100000, balance_sheet_sek: 500000, dividend_sek: 0, dividend_reported: true }],
          ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 }]
        }),
        related: [
          company({
            orgNr: '5594427808',
            name: 'Wellgo Health AB',
            basic: { registeredAt: '2006-05-10', bolagStatus: 'aktiv', bolagsform: 'AB' },
            financials: [{ year: 2025, employees: 10, revenue_sek: 5_000_000, balance_sheet_sek: 3_000_000 }]
          })
        ],
        manual: normalizeScreeningFacts({
          companies: { '5595728790': { concentration: { verdict: 'yes' }, takeover: { verdict: 'yes' } } }
        })
      })
    )
  );
  const diff = diffScreeningRuns(before, after);
  const texts = diff.changes.map((c) => c.text);
  assert.ok(texts.some((t) => t.startsWith('Statsstöd:')), 'utfallet ändrades (anknutet bolag från 2006 ⇒ de minimis)');
  assert.ok(diff.changes.some((c) => c.kind === 'company_added' && c.text.includes('Wellgo Health AB')));
  assert.ok(diff.changes.some((c) => c.kind === 'check' && c.text.includes('Combly AB:') && c.to === 'Ja'));
  assert.ok(diff.changes.some((c) => c.kind === 'missing_resolved'));
  assert.ok(diff.changes.some((c) => c.kind === 'threshold'));
  assert.ok(diff.resolved > 0);
  // Fristående-punkten gick från Ja (inga ägare) till Okänt (bolagsägare) — en regress som ska synas.
  assert.ok(diff.regressed >= 1);
  // Samma körning två gånger ⇒ inga ändringar
  assert.deepEqual(diffScreeningRuns(after, after), { changes: [], resolved: 0, regressed: 0 });
});

test('diffScreeningRuns: tone — till Nej är sämre, okänt → ja är bättre', () => {
  const base = summarizeScreeningRun(screenExcellence(input()));
  const worse = { ...base, excellence: 'no' as const, state_aid: 'not_eligible' as const };
  const d = diffScreeningRuns(base, worse);
  assert.ok(d.changes.every((c) => c.tone === 'worse'));
  const better = { ...base, excellence: 'yes' as const };
  assert.equal(diffScreeningRuns(base, better).changes[0].tone, 'better');
});
