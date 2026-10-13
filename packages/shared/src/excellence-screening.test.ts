import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOwnershipEntry,
  deriveGroupCompanies,
  deriveRelatedCompanies,
  describeCompanyAge,
  dividendCheck,
  indirectPersonOwnership,
  listedCheck,
  ownershipShareRange,
  screenExcellence,
  type ExcellenceScreeningInput,
  type GroupCompanyFacts
} from './excellence-screening';

const REF = new Date('2026-10-12T00:00:00Z');

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

function input(over: Partial<ExcellenceScreeningInput>): ExcellenceScreeningInput {
  return {
    refDate: REF,
    subject: company({ orgNr: '5595728790', name: 'Combly AB' }),
    related: [],
    sekPerEur: 11.3,
    ...over
  };
}

test('describeCompanyAge räknar hela år och månader', () => {
  assert.equal(describeCompanyAge(new Date('2026-02-17T00:00:00Z'), REF), '7 mån');
  assert.equal(describeCompanyAge(new Date('2023-07-01T00:00:00Z'), REF), '3 år och 3 mån');
  assert.equal(describeCompanyAge(new Date('2006-05-10T00:00:00Z'), new Date('2026-05-10T00:00:00Z')), '20 år');
});

test('ownershipShareRange: exakt andel vinner över intervall, högsta av kapital/röster', () => {
  assert.deepEqual(ownershipShareRange({ direction: 'owner', owner_kind: 'company', capital_pct: 40, voting_pct: 60 }), { min: 60, max: 60 });
  assert.deepEqual(ownershipShareRange({ direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 }), { min: 25, max: 50 });
  assert.equal(ownershipShareRange({ direction: 'owner', owner_kind: 'company' }), null);
});

test('classifyOwnershipEntry följer bilaga I-trösklarna', () => {
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 100 }).relation, 'linked');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 51 }).relation, 'linked');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 50 }).relation, 'partner');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 25 }).relation, 'partner');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 24.9 }).relation, 'none');
  assert.equal(classifyOwnershipEntry({ direction: 'holding', owner_kind: 'company', capital_pct: 30 }).relation, 'partner');
  // Undantagna investerare med 25–50 % bryter inte fristående
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'investor', capital_pct: 30 }).relation, 'exempt');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'public_body', capital_pct: 30 }).relation, 'exempt');
  // ... men majoritet gör alltid anknutet
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'investor', capital_pct: 60 }).relation, 'linked');
  // Kontroll via styrelse/avtal = anknutet oavsett andel
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', capital_pct: 10, control_basis: 'board' }).relation, 'linked');
  // Intervall som korsar en tröskel är oklart; fysiska personer klassas inte
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'company', pct_min: 10, pct_max: 30 }).relation, 'uncertain');
  assert.equal(classifyOwnershipEntry({ direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100 }).relation, 'none');
});

test('deriveRelatedCompanies: en rad per org-nr, starkaste relationen vinner', () => {
  const refs = deriveRelatedCompanies([
    { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo', capital_pct: 100 },
    { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo', voting_pct: 30 },
    { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', name: 'Ewell', capital_pct: 90, indirect: true },
    { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 },
    { direction: 'owner', owner_kind: 'investor', capital_pct: 30, name: 'VC' }
  ]);
  assert.deepEqual(
    refs.map((r) => [r.org_nr ?? r.name, r.relation, r.indirect]),
    [
      ['5594427808', 'linked', false],
      ['5567036271', 'linked', true],
      ['VC', 'exempt', false]
    ]
  );
});

test('Combly-fallet: anknutet bolag äldre än 5 år ⇒ de minimis, inte art. 22', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Combly AB',
        ownership: [
          { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100, voting_pct: 100 },
          { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', name: 'Ewell AB', capital_pct: 90, voting_pct: 90, indirect: true }
        ]
      }),
      related: [
        company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2023-07-01', bolagStatus: 'aktiv' } }),
        company({
          orgNr: '5567036271',
          name: 'Ewell AB',
          basic: { registeredAt: '2006-05-01', bolagStatus: 'aktiv' },
          financials: [{ year: 2025, employees: 2, revenue_sek: 141_000, balance_sheet_sek: 1_100_000 }]
        })
      ],
      founders: [
        { name: 'A', equity_pct: 45 },
        { name: 'B', equity_pct: 45 },
        { name: 'C', equity_pct: 5 },
        { name: 'D', equity_pct: 5 }
      ],
      deMinimis: { usedEur: 0, capEur: 300_000 },
      meetsExcellenceFlag: false
    })
  );
  assert.equal(res.standalone.verdict, 'no');
  assert.deepEqual(
    res.companies.map((c) => [c.name, c.role]),
    [
      ['Combly AB', 'subject'],
      ['Wellgo Health AB', 'linked'],
      ['Ewell AB', 'linked']
    ]
  );
  const ewell = res.companies[2];
  assert.equal(ewell.conditions.find((c) => c.id === 'age')?.verdict, 'no');
  assert.equal(res.companies[1].conditions.find((c) => c.id === 'age')?.verdict, 'yes');
  assert.equal(res.stateAid.outcome, 'de_minimis');
  assert.match(res.stateAid.text, /Ewell AB är äldre än 5 år/);
  // Tröskelvärden: sammanlagt 2 anställda (Ewell), under taket — men startup
  // och Wellgo saknar bokslut så summan är inte komplett.
  assert.equal(res.thresholds.combined.employees, 2);
  assert.equal(res.thresholds.combined.complete, false);
  assert.equal(res.thresholds.check.verdict, 'unknown');
  // Vinnova: grundarna äger 100 % ⇒ JA
  assert.equal(res.vinnovaChecks[0].verdict, 'yes');
  assert.equal(res.vinnova.outcome, 'in_target_possible');
  assert.equal(res.excellence.verdict, 'unknown');
});

test('fristående bolag med kompletta bokslut ⇒ art. 22 möjlig', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Solo AB',
        basic: { registeredAt: '2024-01-15', bolagStatus: 'aktiv' },
        financials: [{ year: 2025, employees: 3, revenue_sek: 2_000_000, balance_sheet_sek: 1_500_000, equity_sek: 300_000, net_result_sek: -400_000 }],
        ownership: [
          { direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100 },
          { direction: 'owner', owner_kind: 'person', pct_min: 10, pct_max: 25 }
        ]
      })
    })
  );
  assert.equal(res.standalone.verdict, 'yes');
  assert.equal(res.thresholds.check.verdict, 'yes');
  assert.equal(res.stateAid.outcome, 'art22_possible');
  // Bolaget finns inte i plattformen ⇒ grundarägande okänt, Vinnova oavgjort
  assert.equal(res.vinnovaChecks[0].verdict, 'unknown');
  assert.equal(res.vinnova.outcome, 'undetermined');
  // Ej marknadsredo-indikationen: eget kapital 300k < 2 × 2,4 M
  assert.equal(res.vinnovaChecks.find((c) => c.id === 'not_market_ready')?.verdict, 'yes');
});

test('partnerföretag räknas proportionellt i tröskelvärdet', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'S AB',
        financials: [{ year: 2025, employees: 2, revenue_sek: 100_000, balance_sheet_sek: 100_000 }],
        ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5560000001', name: 'P AB', capital_pct: 40 }]
      }),
      related: [
        company({
          orgNr: '5560000001',
          name: 'P AB',
          basic: { registeredAt: '2010-01-01', bolagStatus: 'aktiv' },
          financials: [{ year: 2025, employees: 10, revenue_sek: 1_000_000, balance_sheet_sek: 500_000 }]
        })
      ]
    })
  );
  assert.equal(res.standalone.verdict, 'no');
  assert.equal(res.thresholds.rows[1].weight, 0.4);
  assert.equal(res.thresholds.combined.employees, 6);
  assert.equal(res.thresholds.combined.revenue_sek, 500_000);
  assert.equal(res.thresholds.check.verdict, 'yes');
  // Partnerns ålder prövas inte (bara anknutnas) ⇒ art. 22 fortfarande möjlig
  assert.equal(res.stateAid.outcome, 'art22_possible');
  assert.equal(res.companies[1].conditions.length, 0);
});

test('för stort anknutet bolag fäller tröskelvärdet', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        financials: [{ year: 2025, employees: 1, revenue_sek: 0, balance_sheet_sek: 50_000 }],
        ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5560000001', name: 'Big AB', capital_pct: 100 }]
      }),
      related: [
        company({
          orgNr: '5560000001',
          name: 'Big AB',
          basic: { registeredAt: '2025-01-01', bolagStatus: 'aktiv' },
          financials: [{ year: 2025, employees: 80, revenue_sek: 1_000_000, balance_sheet_sek: 500_000 }]
        })
      ]
    })
  );
  assert.equal(res.thresholds.check.verdict, 'no');
  assert.equal(res.stateAid.outcome, 'de_minimis');
});

test('anknutet bolag utan uppslag ⇒ oavgjort och saknat underlag', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        financials: [{ year: 2025, employees: 1, revenue_sek: 0, balance_sheet_sek: 50_000 }],
        ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5560000001', name: 'Mor AB', capital_pct: 100 }]
      })
    })
  );
  assert.equal(res.companies[1].dataFetched, false);
  assert.equal(res.stateAid.outcome, 'undetermined');
  assert.match(res.stateAid.text, /anknutna bolags ålder/);
  assert.ok(res.missing.some((m) => /Registreringsdatum/.test(m)));
});

test('inte hämtad koncernstruktur ⇒ fristående okänt; enskild firma ⇒ manuell', () => {
  const a = screenExcellence(input({ subject: company({ orgNr: '5595728790', groupStructureFetched: false, beneficialOwnersFetched: false }) }));
  assert.equal(a.standalone.verdict, 'unknown');
  assert.equal(a.standalone.source, 'register');
  const b = screenExcellence(
    input({ subject: company({ orgNr: '1901010001', basic: { isPersonal: true, registeredAt: '2025-01-01', bolagStatus: 'aktiv' } }) })
  );
  assert.equal(b.standalone.source, 'manual');
  assert.equal(b.companies.length, 1);
});

test('de minimis-utrymme förbrukat + fel art. 22 ⇒ inget företagsstöd och ej målgrupp', () => {
  const res = screenExcellence(
    input({
      subject: company({ orgNr: '5595728790', basic: { registeredAt: '2015-01-01', bolagStatus: 'aktiv' } }),
      deMinimis: { usedEur: 300_000, capEur: 300_000 },
      founders: [{ name: 'A', equity_pct: 100 }]
    })
  );
  assert.equal(res.stateAid.outcome, 'not_eligible');
  assert.equal(res.vinnova.outcome, 'not_in_target');
});

test('grundare under 75 % ⇒ ingår inte i målgruppen', () => {
  const res = screenExcellence(
    input({ founders: [{ name: 'A', equity_pct: 40 }, { name: 'B', equity_pct: 20 }], deMinimis: { usedEur: 0, capEur: 300_000 } })
  );
  assert.equal(res.vinnovaChecks[0].verdict, 'no');
  assert.equal(res.vinnova.outcome, 'not_in_target');
});

test('"inga uppgifter" hos leverantören (tom bokslutslista, hämtade ägardelar) är ett svar — inte ett uteblivet uppslag', () => {
  // Nystartat bolag: Roaring svarar 404 på bokslut och koncern → delarna är
  // hämtade med tomt resultat. Tröskelraden ska säga "inget bokslut i
  // registret", inte "bokslut hämtades inte", och fristående-frågan ska inte
  // fastna på "koncernstrukturen hämtades inte".
  const r = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        financials: [],
        ownership: [{ direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100, control_basis: 'shares' }],
        groupStructureFetched: true,
        beneficialOwnersFetched: true
      })
    })
  );
  assert.equal(r.thresholds.rows[0].note, 'Inget bokslut i registret (nystartat?)');
  assert.notEqual(r.standalone.detail, 'Koncernstrukturen hämtades inte.');
});

// ─── Vinstutdelning (art. 22: "har inte delat ut vinst") ur årsredovisningen ──

const REG = new Date('2022-03-10T00:00:00Z');

test('utdelning > 0 i något år ⇒ NEJ ur registret och fäller art. 22', () => {
  const c = dividendCheck(
    [
      { year: 2023, dividend_reported: true, dividend_sek: 0 },
      { year: 2024, dividend_reported: true, dividend_sek: 150_000 }
    ],
    REG,
    REF,
    false
  );
  assert.equal(c.verdict, 'no');
  assert.equal(c.source, 'register');
  assert.match(c.detail, /2024: 150.000 kr/);

  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        basic: { registeredAt: '2022-03-10', bolagStatus: 'aktiv', bolagsform: 'AB' },
        financials: [{ year: 2024, dividend_reported: true, dividend_sek: 150_000, employees: 2, revenue_sek: 1_000_000, balance_sheet_sek: 500_000 }],
        ownership: [
          { direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100 },
          { direction: 'owner', owner_kind: 'person', pct_min: 10, pct_max: 25 }
        ]
      }),
      deMinimis: { usedEur: 0, capEur: 300_000 }
    })
  );
  assert.equal(res.stateAid.outcome, 'de_minimis');
  assert.match(res.stateAid.text, /har delat ut vinst/);
});

test('0 kr i varje räkenskapsår sedan registreringen ⇒ JA ur registret, och vinstutdelning lämnar de manuella kontrollerna', () => {
  const c = dividendCheck(
    [
      { year: 2023, dividend_reported: true, dividend_sek: 0 },
      { year: 2024, dividend_reported: true, dividend_sek: 0 },
      { year: 2025, dividend_reported: true, dividend_sek: 0 }
    ],
    REG,
    REF,
    false
  );
  assert.equal(c.verdict, 'yes');
  assert.equal(c.source, 'register');
  assert.match(c.detail, /2023, 2024, 2025/);

  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        basic: { registeredAt: '2022-03-10', bolagStatus: 'aktiv', bolagsform: 'AB' },
        financials: [
          { year: 2023, dividend_reported: true, dividend_sek: 0, employees: 1, revenue_sek: 10_000, balance_sheet_sek: 50_000 },
          { year: 2024, dividend_reported: true, dividend_sek: 0, employees: 2, revenue_sek: 100_000, balance_sheet_sek: 500_000 },
          { year: 2025, dividend_reported: true, dividend_sek: 0, employees: 2, revenue_sek: 200_000, balance_sheet_sek: 600_000 }
        ],
        ownership: [
          { direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100 },
          { direction: 'owner', owner_kind: 'person', pct_min: 10, pct_max: 25 }
        ]
      }),
      deMinimis: { usedEur: 0, capEur: 300_000 }
    })
  );
  assert.equal(res.stateAid.outcome, 'art22_possible');
  assert.doesNotMatch(res.stateAid.text, /manuella kontrollerna \([^)]*vinstutdelning/);
  assert.match(res.stateAid.text, /ingen vinstutdelning enligt årsredovisningarna/);
});

test('0 kr men ett år saknas ⇒ OKÄNT med vilket år som saknas — aldrig ett tyst JA', () => {
  const c = dividendCheck(
    [
      { year: 2023, dividend_reported: true, dividend_sek: 0 },
      { year: 2025, dividend_reported: true, dividend_sek: 0 }
    ],
    REG,
    REF,
    false
  );
  assert.equal(c.verdict, 'unknown');
  assert.match(c.detail, /år 2024 saknas/);
  assert.match(c.needs ?? '', /2024/);
});

test('utan registreringsdatum kan täckningen inte bekräftas ⇒ OKÄNT', () => {
  const c = dividendCheck([{ year: 2024, dividend_reported: true, dividend_sek: 0 }], null, REF, false);
  assert.equal(c.verdict, 'unknown');
  assert.match(c.detail, /registreringsdatum saknas/);
});

test('ingen årsredovisning hämtad ⇒ OKÄNT (manuell) med resultatet som ledtråd — 0 utan flagga räknas aldrig', () => {
  const loss = dividendCheck([{ year: 2024, net_result_sek: -40_000, dividend_sek: 0 }], REG, REF, false);
  assert.equal(loss.verdict, 'unknown');
  assert.equal(loss.source, 'manual');
  assert.match(loss.detail, /bara förlustår/);

  const profit = dividendCheck([{ year: 2023, net_result_sek: -1 }, { year: 2024, net_result_sek: 90_000 }], REG, REF, false);
  assert.equal(profit.verdict, 'unknown');
  assert.match(profit.detail, /vinst 2024/);

  const none = dividendCheck([], REG, REF, true);
  assert.equal(none.verdict, 'unknown');
  assert.match(none.detail, /Inget uppslag/);
});

// ─── Manuella svar (§ 51.4) ───────────────────────────────────────────────────

const STANDALONE_OWNERS = [
  { direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100 },
  { direction: 'owner', owner_kind: 'person', pct_min: 10, pct_max: 25 }
] as const;

test('manuella JA fyller okända grundförutsättningar och gör art. 22-texten villkorslös', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Combly AB',
        basic: { registeredAt: '2022-03-10', bolagStatus: 'aktiv' },
        financials: [
          { year: 2023, employees: 2, revenue_sek: 100_000, balance_sheet_sek: 500_000, dividend_sek: 0, dividend_reported: true },
          { year: 2024, employees: 3, revenue_sek: 400_000, balance_sheet_sek: 900_000, dividend_sek: 0, dividend_reported: true }
        ],
        ownership: [...STANDALONE_OWNERS]
      }),
      manual: {
        companies: {
          '5595728790': {
            listed: { verdict: 'yes', note: 'bolagsordning' },
            concentration: { verdict: 'yes' },
            takeover: { verdict: 'yes' }
          }
        },
        de_minimis_related: {},
        estimates: {},
        comment: 'Granskad av controller.'
      }
    })
  );
  const subj = res.companies[0];
  const listed = subj.conditions.find((c) => c.id === 'listed');
  // "Combly AB" är ett privat aktiebolag (ingen (publ)-beteckning) ⇒ registret
  // svarar redan JA; det manuella JA:t behövs inte och ändrar inte källan.
  assert.equal(listed?.verdict, 'yes');
  assert.equal(listed?.source, 'register');
  const concentration = subj.conditions.find((c) => c.id === 'concentration');
  assert.equal(concentration?.verdict, 'yes');
  assert.equal(concentration?.source, 'manual');
  assert.equal(res.stateAid.outcome, 'art22_possible');
  assert.match(res.stateAid.text, /alla grundförutsättningar är besvarade/);
  assert.doesNotMatch(res.stateAid.text, /förutsatt/);
  assert.equal(res.comment, 'Granskad av controller.');
});

test('manuellt NEJ vinner alltid; manuellt JA kan inte skriva över ett register-NEJ', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Combly AB',
        basic: { registeredAt: '2022-03-10', bolagStatus: 'aktiv' },
        financials: [{ year: 2024, employees: 3, revenue_sek: 400_000, balance_sheet_sek: 900_000, dividend_sek: 50_000, dividend_reported: true }],
        ownership: [...STANDALONE_OWNERS]
      }),
      manual: {
        companies: { '5595728790': { dividend: { verdict: 'yes', note: 'intyg' }, takeover: { verdict: 'no', note: 'köpte inkråm 2023' } } },
        de_minimis_related: {},
        estimates: {}
      }
    })
  );
  const subj = res.companies[0];
  const dividend = subj.conditions.find((c) => c.id === 'dividend');
  assert.equal(dividend?.verdict, 'no');
  assert.match(dividend?.detail ?? '', /avviker från registret/);
  const takeover = subj.conditions.find((c) => c.id === 'takeover');
  assert.equal(takeover?.verdict, 'no');
  assert.equal(takeover?.source, 'manual');
  assert.equal(res.stateAid.outcome, 'de_minimis');
  assert.match(res.stateAid.text, /har övertagit annat företags verksamhet/);
  assert.match(res.stateAid.text, /har delat ut vinst/);
});

test('grundardrivet räknas mot fasens trösklar; formation har inget krav', () => {
  const founders = [
    { name: 'A', equity_pct: 50, engagement_pct: 30 },
    { name: 'B', equity_pct: 30, engagement_pct: 15 }
  ];
  const base = { subject: company({ orgNr: '5595728790', name: 'Combly AB', ownership: [...STANDALONE_OWNERS] }), founders, foundersSource: 'manual' as const };
  const psf = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, estimates: {}, maturity_phase: 'problem_solution_fit' } }));
  const fd = psf.vinnovaChecks.find((c) => c.id === 'founder_driven');
  assert.equal(fd?.verdict, 'yes');
  assert.match(fd?.detail ?? '', /sammantaget 45 %/);
  const pmf = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, estimates: {}, maturity_phase: 'product_market_fit' } }));
  assert.equal(pmf.vinnovaChecks.find((c) => c.id === 'founder_driven')?.verdict, 'no');
  assert.equal(pmf.vinnova.outcome, 'not_in_target');
  const form = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, estimates: {}, maturity_phase: 'formation' } }));
  assert.equal(form.vinnovaChecks.find((c) => c.id === 'founder_driven')?.verdict, 'yes');
  const none = screenExcellence(input({ ...base }));
  assert.equal(none.vinnovaChecks.find((c) => c.id === 'founder_driven')?.verdict, 'unknown');
  // Grundarna är manuellt inmatade ⇒ källan på 75 %-punkten är manuell.
  assert.equal(none.vinnovaChecks[0].source, 'manual');
  assert.equal(none.vinnovaChecks[0].verdict, 'yes');
});

test('de minimis räknar anknutna bolag: plattformen eller intyg, annars OKÄNT med vilka som saknas', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Combly AB',
    basic: { registeredAt: '2024-03-10', bolagStatus: 'aktiv' },
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 },
      { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', name: 'Ewell AB', capital_pct: 90, indirect: true }
    ]
  });
  const related = [
    company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2024-01-01', bolagStatus: 'aktiv' }, deMinimis: { usedEur: 20_000, source: 'platform' } }),
    company({ orgNr: '5567036271', name: 'Ewell AB', basic: { registeredAt: '2006-05-10', bolagStatus: 'aktiv' } })
  ];
  const open = screenExcellence(input({ subject, related, deMinimis: { usedEur: 10_000, capEur: 300_000 } }));
  assert.equal(open.deMinimis.verdict, 'unknown');
  assert.match(open.deMinimis.needs ?? '', /Ewell AB/);
  assert.match(open.deMinimis.detail, /Sammanlagt 30.000 €/);
  const certified = screenExcellence(
    input({
      subject,
      related,
      deMinimis: { usedEur: 10_000, capEur: 300_000 },
      manual: { companies: {}, de_minimis_related: { '5567036271': { used_eur: 100_000, note: 'intyg 2026-10-01' } } }
    })
  );
  assert.equal(certified.deMinimis.verdict, 'yes');
  assert.equal(certified.deMinimis.source, 'manual');
  assert.match(certified.deMinimis.detail, /Sammanlagt 130.000 €/);
  const exceeded = screenExcellence(
    input({
      subject,
      related,
      deMinimis: { usedEur: 10_000, capEur: 300_000 },
      manual: { companies: {}, de_minimis_related: { '5567036271': { used_eur: 295_000 } } }
    })
  );
  assert.equal(exceeded.deMinimis.verdict, 'no');
  assert.equal(exceeded.stateAid.outcome, 'not_eligible');
});

test('IRL: manuella nivåer används bara utan readiness-rad; motivering följer alltid med', () => {
  const base = { subject: company({ orgNr: '5595728790', name: 'Combly AB' }) };
  const manualIrl = screenExcellence(
    input({ ...base, irl: { level: 4 }, manual: { companies: {}, de_minimis_related: {}, estimates: {}, irl: { levels: { crl: 3, brl: 2 }, notes: { crl: 'LOI med två kunder' } } } })
  );
  assert.equal(manualIrl.irl?.crl, 3);
  assert.equal(manualIrl.irl?.manualLevels, true);
  assert.equal(manualIrl.irl?.notes?.crl, 'LOI med två kunder');
  const platformIrl = screenExcellence(
    input({ ...base, irl: { level: 4, crl: 5, brl: 4, tmrl: 3, srl: 2 }, manual: { companies: {}, de_minimis_related: {}, estimates: {}, irl: { levels: { crl: 9 }, notes: { srl: 'Agenda 2030 mål 3' } } } })
  );
  assert.equal(platformIrl.irl?.crl, 5);
  assert.notEqual(platformIrl.irl?.manualLevels, true);
  assert.equal(platformIrl.irl?.notes?.srl, 'Agenda 2030 mål 3');
});

test('Vinnova-utfallet blir "ingår sannolikt" utan förbehåll när alla punkter är JA', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Combly AB',
        basic: { registeredAt: '2024-03-10', bolagStatus: 'aktiv' },
        financials: [{ year: 2025, employees: 2, revenue_sek: 100_000, balance_sheet_sek: 400_000, equity_sek: 50_000, net_result_sek: -300_000 }],
        ownership: [...STANDALONE_OWNERS]
      }),
      founders: [{ name: 'A', equity_pct: 80, engagement_pct: 60 }],
      deMinimis: { usedEur: 0, capEur: 300_000 },
      meetsExcellenceFlag: false,
      manual: {
        companies: {},
        de_minimis_related: {},
        estimates: {},
        maturity_phase: 'problem_solution_fit',
        innovative: { verdict: 'yes', note: 'patentsökt sensor' },
        other_criteria: { verdict: 'yes' },
        excellence: { verdict: 'yes', note: 'beslut 2026-10-12' }
      }
    })
  );
  assert.equal(res.vinnova.outcome, 'in_target_possible');
  assert.match(res.vinnova.text, /uppfyllda enligt underlaget/);
  assert.equal(res.excellence.verdict, 'yes');
  assert.equal(res.excellence.source, 'manual');
});

// ─── Börsnotering ur registret (ABL 28 kap. 7 §) ──────────────────────────────

test('listedCheck: privat aktiebolag ⇒ JA ur registret; (publ) ⇒ OKÄNT; andra bolagsformer ⇒ JA', () => {
  const priv = listedCheck(company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { bolagsform: 'Aktiebolag', registeredAt: '2023-07-01' } }));
  assert.equal(priv.verdict, 'yes');
  assert.equal(priv.source, 'register');
  assert.match(priv.detail, /\(publ\)/);
  // Bara namnet känt (bolag i koncernlistan utan uppslag) räcker för ett AB.
  const nameOnly = listedCheck({ orgNr: '5566778899', name: 'Syskon AB', dataFetched: false, ownership: [], groupStructureFetched: false, beneficialOwnersFetched: false });
  assert.equal(nameOnly.verdict, 'yes');
  const publ = listedCheck(company({ orgNr: '5560160680', name: 'Storbolaget AB (publ)', basic: { bolagsform: 'Aktiebolag' } }));
  assert.equal(publ.verdict, 'unknown');
  assert.equal(publ.source, 'manual');
  const publForm = listedCheck(company({ orgNr: '5560160680', name: 'Storbolaget AB', basic: { bolagsform: 'Publikt aktiebolag' } }));
  assert.equal(publForm.verdict, 'unknown');
  const hb = listedCheck(company({ orgNr: '9696969695', name: 'Firman', basic: { bolagsform: 'Handelsbolag' } }));
  assert.equal(hb.verdict, 'yes');
  const ef = listedCheck(company({ orgNr: '1901010001', name: 'Firman', basic: { isPersonal: true } }));
  assert.equal(ef.verdict, 'yes');
  const unknown = listedCheck({ orgNr: '5560000001', dataFetched: false, ownership: [], groupStructureFetched: false, beneficialOwnersFetched: false });
  assert.equal(unknown.verdict, 'unknown');
});

test('Wellgo-fallet: ett privat AB utan manuella svar är INTE börsnoterat enligt registret', () => {
  // Incident 2026-10-13: bedömningen sade "Wellgo Health AB är börsnoterat"
  // (ett inverterat manuellt svar). Nu avgörs punkten ur registret.
  const res = screenExcellence(
    input({ subject: company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2023-07-01', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' } }) })
  );
  assert.equal(res.companies[0].conditions.find((c) => c.id === 'listed')?.verdict, 'yes');
  assert.doesNotMatch(res.stateAid.text, /börsnoterat/);
  // Ett (inverterat) manuellt "börsnoterat" kan inte skriva över registret för ett privat AB.
  const withBadAnswer = screenExcellence(
    input({
      subject: company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2023-07-01', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' } }),
      manual: { companies: { '5594427808': { listed: { verdict: 'no' } } }, de_minimis_related: {}, estimates: {} }
    })
  );
  const l = withBadAnswer.companies[0].conditions.find((c) => c.id === 'listed');
  assert.equal(l?.verdict, 'yes');
  assert.match(l?.detail ?? '', /bortses från/);
  // Ett publikt bolag däremot: manuellt NEJ gäller.
  const publ = screenExcellence(
    input({
      subject: company({ orgNr: '5560160680', name: 'Noterat AB (publ)', basic: { registeredAt: '2023-07-01', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' } }),
      manual: { companies: { '5560160680': { listed: { verdict: 'no', note: 'First North' } } }, de_minimis_related: {}, estimates: {} }
    })
  );
  assert.equal(publ.companies[0].conditions.find((c) => c.id === 'listed')?.verdict, 'no');
  assert.match(publ.stateAid.text, /är börsnoterat/);
});

// ─── Hela koncernen ur koncernregistrets platta lista ─────────────────────────

const GROUP = [
  { org_nr: '5567036271', name: 'Ewell AB', level: 0 },
  { org_nr: '5594427808', name: 'Wellgo Health AB', level: 1, mother_org_nr: '5567036271', mother_name: 'Ewell AB', owned_pct: 90 },
  { org_nr: '5595728790', name: 'Combly AB', level: 2, mother_org_nr: '5594427808', mother_name: 'Wellgo Health AB', owned_pct: 100 },
  { org_nr: '5566778899', name: 'Syskon AB', level: 2, mother_org_nr: '5594427808', mother_name: 'Wellgo Health AB', owned_pct: 100 },
  { org_nr: '5594429630', name: 'Dotter AB', level: 3, mother_org_nr: '5595728790', mother_name: 'Combly AB', owned_pct: 51 }
];

test('deriveGroupCompanies: moder, moderns moder, systerbolag och dotterbolag är alla anknutna', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Combly AB',
    ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 }],
    groupMembers: GROUP
  });
  const refs = deriveGroupCompanies(subject, []);
  const byOrg = Object.fromEntries(refs.map((r) => [r.org_nr, r]));
  assert.equal(refs.length, 4);
  assert.equal(byOrg['5594427808'].relation, 'linked');
  assert.equal(byOrg['5594427808'].groupRole, 'parent');
  assert.ok(!byOrg['5594427808'].indirect, 'direkt moder (ur ägarbilden) förblir direkt');
  assert.equal(byOrg['5594427808'].sharePct, 100, 'moderns andel = dess andel av startup-bolaget');
  assert.equal(byOrg['5567036271'].sharePct, 90, 'moderns moder: dess andel av modern');
  assert.equal(byOrg['5567036271'].groupRole, 'parent');
  assert.equal(byOrg['5567036271'].indirect, true);
  assert.equal(byOrg['5566778899'].groupRole, 'sibling');
  assert.equal(byOrg['5566778899'].relation, 'linked');
  assert.equal(byOrg['5566778899'].via, 'Wellgo Health AB');
  assert.equal(byOrg['5594429630'].groupRole, 'subsidiary');
  assert.ok(!refs.some((r) => r.org_nr === '5595728790'), 'aldrig startup-bolaget självt');
});

test('koncern: ett systerbolag äldre än 5 år fäller art. 22 även när moder och startup är unga', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Combly AB',
    basic: { registeredAt: '2026-02-17', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' },
    groupMembers: [
      { org_nr: '5594427808', name: 'Wellgo Health AB', level: 0 },
      { org_nr: '5595728790', name: 'Combly AB', level: 1, mother_org_nr: '5594427808', owned_pct: 100 },
      { org_nr: '5566778899', name: 'Gammalt Syskon AB', level: 1, mother_org_nr: '5594427808', owned_pct: 100 }
    ]
  });
  const res = screenExcellence(
    input({
      subject,
      related: [
        company({ orgNr: '5594427808', name: 'Wellgo Health AB', basic: { registeredAt: '2025-01-01', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' } }),
        company({ orgNr: '5566778899', name: 'Gammalt Syskon AB', basic: { registeredAt: '2010-01-01', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' }, financials: [{ year: 2025, employees: 4, revenue_sek: 2_000_000, balance_sheet_sek: 900_000 }] })
      ],
      deMinimis: { usedEur: 0, capEur: 300_000 }
    })
  );
  assert.deepEqual(
    res.companies.map((c) => [c.name, c.role, c.groupRole]),
    [
      ['Combly AB', 'subject', undefined],
      ['Wellgo Health AB', 'linked', 'parent'],
      ['Gammalt Syskon AB', 'linked', 'sibling']
    ]
  );
  assert.equal(res.standalone.verdict, 'no');
  assert.match(res.standalone.detail, /systerbolag under Wellgo Health AB/);
  assert.equal(res.stateAid.outcome, 'de_minimis');
  assert.match(res.stateAid.text, /Gammalt Syskon AB är äldre än 5 år/);
  // Tröskelvärdet räknar systerbolaget till 100 %.
  assert.equal(res.thresholds.rows.find((r) => r.orgNr === '5566778899')?.weight, 1);
  assert.equal(res.thresholds.combined.employees, 4);
});

test('andra ledet: ett uppslaget anknutet bolags egna anknutna läggs till; partnerns anknutna får partnerns andel', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'S AB',
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Mor AB', capital_pct: 100 },
      { direction: 'owner', owner_kind: 'company', org_nr: '5560000001', name: 'P AB', capital_pct: 40 }
    ]
  });
  const refs = deriveGroupCompanies(subject, [
    company({ orgNr: '5594427808', name: 'Mor AB', ownership: [{ direction: 'holding', owner_kind: 'company', org_nr: '5566778899', name: 'Kusin AB', capital_pct: 100 }] }),
    company({ orgNr: '5560000001', name: 'P AB', groupMembers: [{ org_nr: '5560000001', name: 'P AB', level: 0 }, { org_nr: '5560000002', name: 'P Dotter AB', level: 1, mother_org_nr: '5560000001', owned_pct: 100 }] })
  ]);
  const byOrg = Object.fromEntries(refs.map((r) => [r.org_nr, r]));
  assert.equal(byOrg['5566778899'].relation, 'linked');
  assert.equal(byOrg['5566778899'].transitive, true);
  assert.equal(byOrg['5566778899'].via, 'Mor AB');
  assert.equal(byOrg['5560000002'].relation, 'partner');
  assert.equal(byOrg['5560000002'].sharePct, 40);
  assert.match(byOrg['5560000002'].reason, /partnerföretaget P AB/);
  assert.ok(!('5560000001' in byOrg && byOrg['5560000001'].transitive));
});

// ─── Indirekt grundarägande via holdingbolag ─────────────────────────────────

test('indirectPersonOwnership räknar personers andel genom ägarkedjan och ger en ledtråd i 75 %-punkten', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Combly AB',
    ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 }]
  });
  const wellgo = company({
    orgNr: '5594427808',
    name: 'Wellgo Health AB',
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', name: 'Ewell AB', capital_pct: 90 },
      { direction: 'owner', owner_kind: 'person', pct_min: 0, pct_max: 25, control_basis: 'shares' }
    ]
  });
  const ewell = company({
    orgNr: '5567036271',
    name: 'Ewell AB',
    ownership: [
      { direction: 'owner', owner_kind: 'person', pct_min: 50, pct_max: 75, control_basis: 'shares' },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50, control_basis: 'shares' }
    ]
  });
  const byOrg = new Map([[wellgo.orgNr, wellgo], [ewell.orgNr, ewell]]);
  const ind = indirectPersonOwnership(subject, byOrg);
  assert.ok(ind);
  // 100 % × (0 + 90 % × (50 + 25)) = 67,5 %
  assert.equal(ind.minPct, 67.5);
  assert.deepEqual(ind.via, ['Wellgo Health AB', 'Ewell AB']);

  const res = screenExcellence(input({ subject, related: [wellgo, ewell], founders: [] }));
  const f75 = res.vinnovaChecks[0];
  assert.equal(f75.verdict, 'unknown');
  assert.match(f75.detail, /Indirekt ägande: via Wellgo Health AB → Ewell AB äger fysiska personer minst 67,5 %/);
});

test('ledtråd när startup-bolaget ägs av bolag men huvudmännen inte hämtats', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Combly AB',
    ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo Health AB', capital_pct: 100 }]
  });
  const res = screenExcellence(input({ subject, founders: [{ name: 'A', equity_pct: 0 }] }));
  assert.equal(res.vinnovaChecks[0].verdict, 'no');
  assert.match(res.vinnovaChecks[0].detail, /ägs till 100 % av bolag/);
});

// ─── Uppskattning för bolag utan bokslut (bilaga I art. 4.3) ─────────────────

test('egen uppskattning fyller tröskelvärdet för ett nystartat bolag utan bokslut', () => {
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        name: 'Ny AB',
        basic: { registeredAt: '2026-02-17', bolagStatus: 'aktiv', bolagsform: 'Aktiebolag' },
        financials: [],
        ownership: [...STANDALONE_OWNERS]
      }),
      manual: { companies: {}, de_minimis_related: {}, estimates: { '5595728790': { employees: 2, revenue_sek: 0, balance_sheet_sek: 50_000, note: 'budget 2026' } } },
      deMinimis: { usedEur: 0, capEur: 300_000 }
    })
  );
  const row = res.thresholds.rows[0];
  assert.equal(row.estimated, true);
  assert.match(row.note ?? '', /uppskattning: budget 2026/);
  assert.equal(res.thresholds.check.verdict, 'yes');
  assert.equal(res.thresholds.check.source, 'manual');
  assert.match(res.thresholds.check.detail, /art\. 4\.3/);
  assert.equal(res.stateAid.outcome, 'art22_possible');
});
