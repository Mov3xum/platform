import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenExcellence, type ExcellenceScreeningInput, type GroupCompanyFacts } from './excellence-screening';
import { normalizeScreeningFacts } from './excellence-facts';
import {
  applyScreeningRequestAnswers,
  canViewScreeningRequest,
  deriveScreeningRequestItems,
  mergeScreeningRequestAnswersIntoFacts,
  normalizeScreeningRequestItems,
  screeningRequestItemsFor,
  screeningRequestStatusFor,
  screeningRequestText,
  validateScreeningRequestInput
} from './excellence-requests';

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
    subject: company({
      orgNr: '5595728790',
      name: 'Combly AB',
      ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 }]
    }),
    related: [company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2020-01-01', bolagStatus: 'aktiv', bolagsform: 'AB' } })],
    deMinimis: { usedEur: 0, capEur: 300000 },
    irl: null,
    meetsExcellenceFlag: false,
    sekPerEur: 11.3,
    ...over
  };
}

test('deriveScreeningRequestItems: varje OKÄNT som en människa kan svara på blir en punkt', () => {
  const result = screenExcellence(input());
  const items = deriveScreeningRequestItems(result, { subjectName: 'Combly AB' });
  const keys = items.map((i) => i.key);
  // Grundförutsättningar per bolag som registret inte avgör (koncentration/övertagande; utdelning utan bokslut)
  assert.ok(keys.includes('condition:5595728790:concentration'));
  assert.ok(keys.includes('condition:5595728790:takeover'));
  assert.ok(keys.includes('condition:5594427808:dividend'));
  // Börsnotering avgörs ur registret för ett privat AB → ingen punkt
  assert.ok(!keys.includes('condition:5595728790:listed'));
  // De minimis-intyg för det anknutna bolaget, uppskattning (inget bokslut), grundarteam, Vinnova, IRL, excellens
  assert.ok(keys.includes('de_minimis:5594427808'));
  assert.ok(keys.includes('estimate:5595728790'));
  assert.ok(keys.includes('founders'));
  assert.ok(keys.includes('vinnova:not_market_ready'));
  assert.ok(keys.includes('irl'));
  assert.ok(keys.includes('excellence'));
  // Alla har etikett + status open, bolagsnamn följer med
  for (const i of items) {
    assert.equal(i.status, 'open');
    assert.ok(i.label.length > 0);
  }
  assert.equal(items.find((i) => i.key === 'de_minimis:5594427808')?.org_name, 'Wellgo Health AB');
});

test('deriveScreeningRequestItems: anknutet bolag med de minimis ur plattformen får inget intyg-ärende', () => {
  const result = screenExcellence(input());
  const items = deriveScreeningRequestItems(result, { deMinimisFromPlatform: ['5594427808'] });
  assert.ok(!items.some((i) => i.key === 'de_minimis:5594427808'));
});

test('screeningRequestItemsFor: bolaget får inte coachens bedömningspunkter', () => {
  const result = screenExcellence(input());
  const items = deriveScreeningRequestItems(result);
  const forStartup = screeningRequestItemsFor(items, 'startup');
  assert.ok(forStartup.every((i) => !['vinnova', 'irl', 'excellence'].includes(i.kind)));
  assert.ok(forStartup.some((i) => i.kind === 'founders'));
  assert.ok(forStartup.some((i) => i.kind === 'condition'));
  const forCoach = screeningRequestItemsFor(items, 'coach');
  assert.equal(forCoach.length, items.length);
});

test('applyScreeningRequestAnswers: giltiga svar markerar punkten, ogiltiga lämnar den, clear öppnar igen', () => {
  const result = screenExcellence(input());
  const items = deriveScreeningRequestItems(result);
  const out = applyScreeningRequestAnswers(items, {
    answers: {
      'condition:5595728790:concentration': { verdict: 'yes', note: 'Nybildat 2026, ägare 850101-1234' },
      'condition:5595728790:takeover': { verdict: 'kanske' },
      founders: { founders: [{ name: 'Anna', equity_pct: '60', engagement_pct: 80 }, { name: '' }], maturity_phase: 'problem_solution_fit' },
      'de_minimis:5594427808': { used_eur: '12 000' },
      'estimate:5595728790': { employees: '2', revenue_sek: 0, balance_sheet_sek: '150000' },
      irl: { levels: { crl: 3, brl: 12 }, notes: { srl: 'Agenda 2030 adresseras' } },
      excellence: { verdict: 'no', note: 'avvikelse' }
    },
    answeredAt: '2026-10-13T10:00:00.000Z',
    answeredBy: 'u1'
  });
  assert.deepEqual(out.rejectedKeys, ['condition:5595728790:takeover']);
  assert.ok(out.answeredKeys.includes('founders'));
  const conc = out.items.find((i) => i.key === 'condition:5595728790:concentration')!;
  assert.equal(conc.status, 'answered');
  assert.equal(conc.answer?.note, 'Nybildat 2026, ägare [REDACTED]');
  assert.equal(conc.answer_label, 'Nej');
  assert.equal(conc.answered_by, 'u1');
  const founders = out.items.find((i) => i.key === 'founders')!;
  assert.deepEqual(founders.answer?.founders, [{ name: 'Anna', equity_pct: 60, engagement_pct: 80 }]);
  assert.equal(founders.answer_label, '1 grundare, engagemang angivet för 1, fas angiven');
  assert.equal(out.items.find((i) => i.key === 'de_minimis:5594427808')!.answer?.used_eur, 12000);
  const est = out.items.find((i) => i.key === 'estimate:5595728790')!;
  assert.deepEqual(est.answer, { employees: 2, revenue_sek: 0, balance_sheet_sek: 150000 });
  const irl = out.items.find((i) => i.key === 'irl')!;
  assert.deepEqual(irl.answer, { levels: { crl: 3 }, notes: { srl: 'Agenda 2030 adresseras' } });
  assert.equal(screeningRequestStatusFor(out.items), 'partially_answered');

  const cleared = applyScreeningRequestAnswers(out.items, { answers: { founders: { clear: true } }, answeredAt: 'x', answeredBy: 'u1' });
  assert.equal(cleared.items.find((i) => i.key === 'founders')!.status, 'open');
  assert.equal(cleared.items.find((i) => i.key === 'founders')!.answer, undefined);
});

test('mergeScreeningRequestAnswersIntoFacts: svaren landar i de manuella svaren, document rör dem inte', () => {
  const result = screenExcellence(input());
  const items = applyScreeningRequestAnswers(deriveScreeningRequestItems(result), {
    answers: {
      'condition:5594427808:dividend': { verdict: 'yes', note: 'intyg 2026-10-01' },
      founders: { founders: [{ name: 'Anna', equity_pct: 60, engagement_pct: 80 }], maturity_phase: 'product_market_fit', research_spinoff: true },
      'de_minimis:5594427808': { used_eur: 5000, note: 'intyg' },
      'estimate:5595728790': { employees: 1 },
      irl: { levels: { crl: 4 }, notes: { crl: 'pilot' } },
      'vinnova:innovative': { verdict: 'yes' },
      excellence: { verdict: 'yes' },
      'document:aktiebok': { note: 'Aktiebok bifogad per mejl' }
    },
    answeredAt: 'x',
    answeredBy: 'u1'
  }).items;
  const facts = mergeScreeningRequestAnswersIntoFacts(normalizeScreeningFacts({ comment: 'befintlig', irl: { notes: { brl: 'tidigare' } } }), items);
  assert.equal(facts.comment, 'befintlig');
  assert.deepEqual(facts.companies['5594427808']?.dividend, { verdict: 'yes', note: 'intyg 2026-10-01' });
  assert.deepEqual(facts.founders, [{ name: 'Anna', equity_pct: 60, engagement_pct: 80 }]);
  assert.equal(facts.maturity_phase, 'product_market_fit');
  assert.equal(facts.research_spinoff, true);
  assert.deepEqual(facts.de_minimis_related['5594427808'], { used_eur: 5000, note: 'intyg' });
  assert.deepEqual(facts.estimates['5595728790'], { employees: 1 });
  assert.deepEqual(facts.irl, { levels: { crl: 4 }, notes: { brl: 'tidigare', crl: 'pilot' } });
  assert.deepEqual(facts.innovative, { verdict: 'yes' });
  assert.deepEqual(facts.excellence, { verdict: 'yes' });
  // onlyKeys begränsar sammanslagningen till de nyss besvarade
  const partial = mergeScreeningRequestAnswersIntoFacts(normalizeScreeningFacts(null), items, ['excellence']);
  assert.deepEqual(partial.excellence, { verdict: 'yes' });
  assert.equal(partial.founders, undefined);
});

test('normalizeScreeningRequestItems: tolerant mot trasig json, dubbletter och okända kinds', () => {
  const items = normalizeScreeningRequestItems([
    { key: 'condition:5595728790:listed', kind: 'condition', label: 'x', org_nr: '559572-8790', condition: 'listed', status: 'answered', answer: { verdict: 'yes' } },
    { key: 'condition:5595728790:listed', kind: 'condition', label: 'dubblett', org_nr: '5595728790', condition: 'listed' },
    { key: 'condition:bad', kind: 'condition', label: 'utan org-nr', condition: 'listed' },
    { key: 'foo', kind: 'okänd', label: 'x' },
    { key: 'irl', kind: 'irl', label: 'IRL', status: 'answered', answer: { levels: { crl: 'tre' } } },
    'skräp',
    null
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].org_nr, '5595728790');
  assert.equal(items[0].status, 'answered');
  assert.equal(items[0].answer_label, 'Nej — inte börsnoterat');
  // Ogiltigt svar ⇒ punkten är öppen igen
  assert.equal(items[1].status, 'open');
  assert.equal(items[1].answer, undefined);
  assert.deepEqual(normalizeScreeningRequestItems('x'), []);
});

test('validateScreeningRequestInput: mottagare styr vilka punkter som tas med, svar nollställs', () => {
  const result = screenExcellence(input());
  const items = deriveScreeningRequestItems(result);
  const bad = validateScreeningRequestInput({ recipient: 'controller', items });
  assert.equal(bad.ok, false);
  const onlyCoach = validateScreeningRequestInput({ recipient: 'startup', items: items.filter((i) => i.kind === 'irl') });
  assert.equal(onlyCoach.ok, false);
  const good = validateScreeningRequestInput({
    recipient: 'startup',
    items: items.map((i) => ({ ...i, status: 'answered', answer: { verdict: 'yes' } })),
    message: 'Hej\n\n\n  tack  \n19900101-1234',
    dueDate: '2026-10-31'
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.ok(good.value.items.every((i) => i.status === 'open' && !i.answer));
    assert.ok(good.value.items.every((i) => i.kind !== 'irl'));
    assert.equal(good.value.message, 'Hej\n\ntack\n[REDACTED]');
    assert.equal(good.value.dueDate, '2026-10-31');
  }
  assert.equal(validateScreeningRequestInput({ recipient: 'coach', items, dueDate: 'imorgon' }).ok, false);
});

test('screeningRequestText: numrerad checklista med länk och frist', () => {
  const result = screenExcellence(input());
  const items = screeningRequestItemsFor(deriveScreeningRequestItems(result), 'startup').slice(0, 2);
  const text = screeningRequestText({
    subjectName: 'Combly AB',
    recipient: 'startup',
    items,
    message: 'Ring gärna vid frågor.',
    answerUrl: 'https://app.movexum.se/komplettering/abc',
    dueDate: '2026-10-31',
    senderName: 'Controllern'
  });
  assert.ok(text.startsWith('Hej! Inför bedömningen av statsstöd'));
  assert.ok(text.includes('1. '));
  assert.ok(text.includes('2. '));
  assert.ok(text.includes('Ring gärna vid frågor.'));
  assert.ok(text.includes('Svar önskas senast 2026-10-31.'));
  assert.ok(text.includes('https://app.movexum.se/komplettering/abc'));
  assert.ok(text.includes('Skriv inga personnummer'));
  assert.ok(text.trim().endsWith('Controllern'));
});

test('canViewScreeningRequest: speglar list/viewRule — staff/observer i tenanten, medlem bara sitt bolags bolagsförfrågan', () => {
  const row = { tenant: 't1', startup: 's1', recipient_kind: 'startup' as const };
  const coachRow = { ...row, recipient_kind: 'coach' as const };
  assert.equal(canViewScreeningRequest({ tenant: 't1', roles: ['coach'] }, row), true);
  assert.equal(canViewScreeningRequest({ tenant: 't1', roles: ['observer'] }, coachRow), true);
  assert.equal(canViewScreeningRequest({ tenant: 't2', roles: ['admin'] }, row), false);
  assert.equal(canViewScreeningRequest({ tenant: '', roles: ['admin'] }, { ...row, tenant: '' }), false);
  const member = { tenant: 't1', roles: ['startup_member'], linkedStartups: ['s1'] };
  assert.equal(canViewScreeningRequest(member, row), true);
  assert.equal(canViewScreeningRequest(member, coachRow), false);
  assert.equal(canViewScreeningRequest({ ...member, linkedStartups: ['s9'] }, row), false);
  assert.equal(canViewScreeningRequest({ tenant: 't1', roles: ['partner'] }, row), false);
});
