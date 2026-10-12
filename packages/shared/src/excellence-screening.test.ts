import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOwnershipEntry,
  deriveGroupCompanies,
  deriveRelatedCompanies,
  describeCompanyAge,
  dividendCheck,
  ownershipShareRange,
  normalizeExcellenceManualReview,
  sameOwnershipPicture,
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

<<<<<<< HEAD
test('manuell komplettering: bara manuella/okända punkter kan kompletteras — systemet vinner alltid', () => {
  const manual = {
    checks: {
      'cond:5595728790:listed': { verdict: 'yes', note: 'Bolagsordning granskad', updated_at: '2026-10-12T10:00:00Z' },
      // Åldern är ett registersvar — en sparad manuell uppgift ska ignoreras.
      'cond:5595728790:age': { verdict: 'no', note: 'fel' },
      innovative: { verdict: 'yes', note: 'Patentsökt sensor' },
      other_criteria: { verdict: 'unknown', note: 'Agenda 2030 oklar' }
    }
  } as const;
  const res = screenExcellence(
    input({
      manual: { checks: { ...manual.checks } },
      founders: [{ name: 'A', equity_pct: 100 }],
      deMinimis: { usedEur: 0, capEur: 300_000 }
    })
  );
  const subj = res.companies[0].conditions;
  const listed = subj.find((c) => c.id === 'listed')!;
  assert.equal(listed.key, 'cond:5595728790:listed');
  assert.equal(listed.verdict, 'yes');
  assert.equal(listed.source, 'manual');
  assert.equal(listed.editable, true);
  assert.match(listed.detail, /Manuellt ja \(2026-10-12\): Bolagsordning granskad/);
  assert.equal(listed.needs, undefined);
  const age = subj.find((c) => c.id === 'age')!;
  assert.equal(age.verdict, 'yes');
  assert.equal(age.source, 'register');
  assert.equal(age.editable, false);
  assert.equal(age.manual, undefined);
  const innovative = res.vinnovaChecks.find((c) => c.id === 'innovative')!;
  assert.equal(innovative.verdict, 'yes');
  assert.equal(innovative.source, 'manual');
  const other = res.vinnovaChecks.find((c) => c.id === 'other_criteria')!;
  assert.equal(other.verdict, 'unknown');
  assert.match(other.detail, /Not: Agenda 2030 oklar/);
  assert.ok(!res.missing.includes('Coachens bedömning av innovationshöjd.'));
  assert.ok(res.missing.includes('Coachens bedömning av Agenda 2030, skalbarhet och kunskapstillgångar.'));
  // Punkterna är spårbara i den platta listan med samma nycklar
  assert.ok(res.checks.some((c) => c.key === 'cond:5595728790:listed' && c.scope === 'Combly AB'));
});

test('manuell komplettering avgör tröskelvärde och de minimis när underlag saknas', () => {
=======
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

>>>>>>> origin/staging
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
<<<<<<< HEAD
        financials: [],
        ownership: [{ direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100, control_basis: 'shares' }]
      }),
      manual: {
        checks: {
          standalone: { verdict: 'yes', note: 'Aktiebok granskad: två grundare' },
          thresholds: { verdict: 'yes', note: 'Bolagets egna uppgifter: 2 anställda, ingen omsättning' },
          de_minimis: { verdict: 'yes', note: 'Intyg 2026-10-01' }
        }
      }
    })
  );
  assert.equal(res.thresholds.check.verdict, 'yes');
  assert.equal(res.thresholds.check.source, 'manual');
  assert.equal(res.standalone.verdict, 'yes');
  assert.equal(res.standalone.source, 'manual');
  assert.equal(res.deMinimis.verdict, 'yes');
  assert.equal(res.stateAid.outcome, 'art22_possible');
});

test('grundardrivet: engagemang + mognadsfas prövas deterministiskt', () => {
  const base = { founders: [{ name: 'Anna', equity_pct: 50 }, { name: 'Bo', equity_pct: 50 }] };
  const noEng = screenExcellence(input(base));
  const fd = noEng.vinnovaChecks.find((c) => c.id === 'founder_driven')!;
  assert.equal(fd.verdict, 'unknown');
  assert.match(fd.hint ?? '', /Anna, Bo/);

  const psf = screenExcellence(
    input({
      ...base,
      manual: { checks: {}, engagement: { phase: 'problem_solution_fit', founders: [{ name: 'Anna', pct: 30 }, { name: 'Bo', pct: 15 }] } }
    })
  ).vinnovaChecks.find((c) => c.id === 'founder_driven')!;
  assert.equal(psf.verdict, 'yes');
  assert.match(psf.detail, /sammantaget 45 %, högst 30 %/);

  const pmf = screenExcellence(
    input({
      ...base,
      manual: { checks: {}, engagement: { phase: 'product_market_fit', founders: [{ name: 'Anna', pct: 30 }, { name: 'Bo', pct: 15 }] } }
    })
  ).vinnovaChecks.find((c) => c.id === 'founder_driven')!;
  assert.equal(pmf.verdict, 'no');

  const formation = screenExcellence(input({ ...base, manual: { checks: {}, engagement: { phase: 'formation', founders: [] } } }));
  assert.equal(formation.vinnovaChecks.find((c) => c.id === 'founder_driven')!.verdict, 'yes');

  // En manuell uppgift på punkten vinner över engagemangsberäkningen (research spinoff → manuellt ja)
  const spin = screenExcellence(
    input({
      ...base,
      manual: {
        checks: { founder_driven: { verdict: 'yes', note: 'Forskarnas engagemang kompletteras av VD' } },
        engagement: { phase: 'research_spinoff', founders: [{ name: 'Anna', pct: 10 }] }
      }
    })
  ).vinnovaChecks.find((c) => c.id === 'founder_driven')!;
  assert.equal(spin.verdict, 'yes');
  assert.match(spin.detail, /Manuellt ja: Forskarnas/);
});

test('börsnotering och utdelning avgörs av registret när uppgiften finns', () => {
=======
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
        comment: 'Granskad av controller.'
      }
    })
  );
  const subj = res.companies[0];
  const listed = subj.conditions.find((c) => c.id === 'listed');
  assert.equal(listed?.verdict, 'yes');
  assert.equal(listed?.source, 'manual');
  assert.match(listed?.detail ?? '', /bolagsordning/);
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
        de_minimis_related: {}
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
  const psf = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, maturity_phase: 'problem_solution_fit' } }));
  const fd = psf.vinnovaChecks.find((c) => c.id === 'founder_driven');
  assert.equal(fd?.verdict, 'yes');
  assert.match(fd?.detail ?? '', /sammantaget 45 %/);
  const pmf = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, maturity_phase: 'product_market_fit' } }));
  assert.equal(pmf.vinnovaChecks.find((c) => c.id === 'founder_driven')?.verdict, 'no');
  assert.equal(pmf.vinnova.outcome, 'not_in_target');
  const form = screenExcellence(input({ ...base, manual: { companies: {}, de_minimis_related: {}, maturity_phase: 'formation' } }));
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
    input({ ...base, irl: { level: 4 }, manual: { companies: {}, de_minimis_related: {}, irl: { levels: { crl: 3, brl: 2 }, notes: { crl: 'LOI med två kunder' } } } })
  );
  assert.equal(manualIrl.irl?.crl, 3);
  assert.equal(manualIrl.irl?.manualLevels, true);
  assert.equal(manualIrl.irl?.notes?.crl, 'LOI med två kunder');
  const platformIrl = screenExcellence(
    input({ ...base, irl: { level: 4, crl: 5, brl: 4, tmrl: 3, srl: 2 }, manual: { companies: {}, de_minimis_related: {}, irl: { levels: { crl: 9 }, notes: { srl: 'Agenda 2030 mål 3' } } } })
  );
  assert.equal(platformIrl.irl?.crl, 5);
  assert.notEqual(platformIrl.irl?.manualLevels, true);
  assert.equal(platformIrl.irl?.notes?.srl, 'Agenda 2030 mål 3');
});

test('Vinnova-utfallet blir "ingår sannolikt" utan förbehåll när alla punkter är JA', () => {
>>>>>>> origin/staging
  const res = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
<<<<<<< HEAD
        basic: { registeredAt: '2025-01-01', bolagStatus: 'aktiv', listed: false },
        financials: [
          { year: 2024, employees: 1, revenue_sek: 100, balance_sheet_sek: 100, dividend_sek: 0 },
          { year: 2025, employees: 1, revenue_sek: 100, balance_sheet_sek: 100, dividend_sek: 50_000 }
        ]
      })
    })
  );
  const cond = res.companies[0].conditions;
  assert.equal(cond.find((c) => c.id === 'listed')!.verdict, 'yes');
  assert.equal(cond.find((c) => c.id === 'listed')!.source, 'register');
  const div = cond.find((c) => c.id === 'dividend')!;
  assert.equal(div.verdict, 'no');
  assert.equal(div.source, 'register');
  assert.match(div.detail, /2025 50\s000 kr/);

  const zero = screenExcellence(
    input({
      subject: company({
        orgNr: '5595728790',
        financials: [{ year: 2025, employees: 1, revenue_sek: 100, balance_sheet_sek: 100, dividend_sek: 0 }]
      })
    })
  ).companies[0].conditions.find((c) => c.id === 'dividend')!;
  assert.equal(zero.verdict, 'unknown');
  assert.equal(zero.source, 'manual');
  assert.match(zero.hint ?? '', /0 kr i utdelning/);
});

test('plattformens statsstödsgrund och flaggor visas som förifyllning, inte som svar', () => {
  const res = screenExcellence(
    input({
      founders: [],
      irl: { level: 4, srl: 3, tmrl: 5 },
      platformHints: { isDeeptech: true, approvedDeMinimis: true, stateAidBasis: { basis: 'art22', validFrom: '2025-01-01' } }
    })
  );
  assert.match(res.stateAid.platformNote ?? '', /art\. 22 GBER sedan 2025-01-01/);
  assert.match(res.deMinimis.hint ?? '', /godkänd de minimis/);
  assert.equal(res.deMinimis.verdict, 'unknown');
  assert.match(res.vinnovaChecks.find((c) => c.id === 'innovative')!.hint ?? '', /deeptech.*TMRL 5/);
  assert.match(res.vinnovaChecks.find((c) => c.id === 'other_criteria')!.hint ?? '', /IRL-nivå 4, SRL 3/);
});

test('normalizeExcellenceManualReview: tolerant, cappad och PII-säker form', () => {
  const r = normalizeExcellenceManualReview({
    checks: {
      innovative: { verdict: 'yes', note: '  bra   idé  ', updated_at: '2026-10-12T10:00:00Z' },
      'bad key!': { verdict: 'yes' },
      empty: { verdict: 'unknown' },
      note_only: { verdict: 'nope', note: 'kolla' },
      long: { verdict: 'no', note: 'x'.repeat(2000) }
    },
    engagement: { phase: 'product_market_fit', founders: [{ name: 'Anna', pct: '35,5' }, { name: '', pct: 10 }, { name: 'Bo', pct: 150 }] }
  });
  assert.deepEqual(r.checks.innovative, { verdict: 'yes', note: 'bra idé', updated_at: '2026-10-12T10:00:00Z' });
  assert.equal(r.checks['bad key!'], undefined);
  assert.equal(r.checks.empty, undefined);
  assert.deepEqual(r.checks.note_only, { verdict: 'unknown', note: 'kolla' });
  assert.equal(r.checks.long?.note?.length, 600);
  assert.deepEqual(r.engagement, { phase: 'product_market_fit', founders: [{ name: 'Anna', pct: 35.5 }, { name: 'Bo', pct: undefined }] });
  assert.deepEqual(normalizeExcellenceManualReview(null), { checks: {} });
  assert.deepEqual(normalizeExcellenceManualReview({ engagement: { phase: 'x', founders: [] } }), { checks: {} });
});

test('deriveGroupCompanies: ägarkedjan följs genom holdingbolaget — vem som äger holdingbolaget avgör', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Workify AB',
    ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5592581416', name: 'Holding AB', capital_pct: 100 }]
  });
  const holding = company({
    orgNr: '5592581416',
    name: 'Holding AB',
    ownership: [
      // Holdingbolagets egen ägarbild: startup-bolaget som innehav (hoppas över),
      // ett bolag med majoritet (anknutet till hela koncernen), en VC med 30 %
      // (undantagen — visas, räknas inte) och grundare som fysiska personer.
      { direction: 'holding', owner_kind: 'company', org_nr: '5595728790', name: 'Workify AB', capital_pct: 100 },
      { direction: 'owner', owner_kind: 'company', org_nr: '5560000002', name: 'Topp AB', capital_pct: 55 },
      { direction: 'owner', owner_kind: 'investor', name: 'VC Fond', capital_pct: 30 },
      { direction: 'owner', owner_kind: 'person', pct_min: 0, pct_max: 25 }
    ]
  });
  const refs = deriveGroupCompanies(subject, [holding]);
  assert.deepEqual(
    refs.map((r) => [r.org_nr ?? r.name, r.relation, r.level, r.via]),
    [
      ['5592581416', 'linked', 1, undefined],
      ['5560000002', 'linked', 2, 'Holding AB'],
      ['VC Fond', 'exempt', 2, 'Holding AB']
    ]
  );
  // Partner: bara företag ANKNUTNA till partnern räknas — med partnerns andel.
  const subject2 = company({
    orgNr: '5595728790',
    ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5560000010', name: 'Partner AB', capital_pct: 40 }]
  });
  const partner = company({
    orgNr: '5560000010',
    name: 'Partner AB',
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5560000011', name: 'Partnermor AB', capital_pct: 90 },
      { direction: 'owner', owner_kind: 'company', org_nr: '5560000012', name: 'Minoritet AB', capital_pct: 30 }
    ]
  });
  const refs2 = deriveGroupCompanies(subject2, [partner]);
  assert.deepEqual(
    refs2.map((r) => [r.org_nr, r.relation, r.sharePct, r.level]),
    [
      ['5560000010', 'partner', 40, 1],
      ['5560000011', 'partner', 40, 2]
    ]
  );
  // Utan hämtad ägarbild för holdingbolaget stannar kedjan vid nivå 1.
  assert.equal(deriveGroupCompanies(subject, []).length, 1);
});

test('"Vem äger holdingbolaget": okänt tills ägarbilden hämtats och täcker > 75 % — investerare med 25–50 % syns inte i registret', () => {
  const ownerRow = { direction: 'owner' as const, owner_kind: 'company' as const, org_nr: '5592581416', name: 'Holding AB', capital_pct: 100 };
  // 1. Holdingbolaget slogs upp utan ägardelarna.
  const noParts = screenExcellence(
    input({
      subject: company({ orgNr: '5595728790', name: 'Workify AB', ownership: [ownerRow] }),
      related: [company({ orgNr: '5592581416', name: 'Holding AB', groupStructureFetched: false, beneficialOwnersFetched: false })]
    })
  );
  const holding = noParts.companies[1];
  assert.equal(holding.ownerChain?.verdict, 'unknown');
  assert.match(holding.ownerChain?.needs ?? '', /koncernstruktur \+ verklig huvudman för Holding AB/);
  assert.match(noParts.standalone.detail, /Ägarkedjan är ännu inte följd för: Holding AB/);
  assert.ok(noParts.missing.some((m) => /Holding AB/.test(m)));
  // 2. Hämtad ägarbild med två grundare om 25–50 % var: täcker bara 50 % ⇒
  //    investerare kan äga resten — manuell kontroll mot aktieboken.
  const persons = screenExcellence(
    input({
      subject: company({ orgNr: '5595728790', name: 'Workify AB', ownership: [ownerRow] }),
      related: [
        company({
          orgNr: '5592581416',
          name: 'Holding AB',
          ownership: [
            { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 },
            { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 }
          ]
        })
      ]
    })
  );
  const chain = persons.companies[1].ownerChain;
  assert.equal(chain?.verdict, 'unknown');
  assert.equal(chain?.source, 'manual');
  assert.match(chain?.detail ?? '', /investerare\/bolag med 25–50 % av Holding AB syns inte/);
  assert.equal(chain?.editable, true);
  // 3. Kända ägare täcker > 75 % ⇒ kedjan är avgjord.
  const covered = screenExcellence(
    input({
      subject: company({ orgNr: '5595728790', name: 'Workify AB', ownership: [ownerRow] }),
      related: [
        company({
          orgNr: '5592581416',
          name: 'Holding AB',
          ownership: [
            { direction: 'owner', owner_kind: 'person', capital_pct: 40 },
            { direction: 'owner', owner_kind: 'person', capital_pct: 40 }
          ]
        })
      ]
    })
  );
  assert.equal(covered.companies[1].ownerChain?.verdict, 'yes');
  assert.match(covered.standalone.detail, /Vem som äger det anknutna bolaget avgör/);
  assert.doesNotMatch(covered.standalone.detail, /ännu inte följd/);
  // 4. Ett bolag som äger holdingbolaget med majoritet blir ett eget koncernbolag (nivå 2, genom Holding AB).
  const topped = screenExcellence(
    input({
      subject: company({ orgNr: '5595728790', name: 'Workify AB', ownership: [ownerRow] }),
      related: [
        company({
          orgNr: '5592581416',
          name: 'Holding AB',
          ownership: [{ direction: 'owner', owner_kind: 'company', org_nr: '5560000002', name: 'Topp AB', capital_pct: 80 }]
        }),
        company({ orgNr: '5560000002', name: 'Topp AB', basic: { registeredAt: '2006-05-10', bolagStatus: 'aktiv', bolagsform: 'AB' } })
      ]
    })
  );
  const topp = topped.companies.find((c) => c.orgNr === '5560000002');
  assert.equal(topp?.role, 'linked');
  assert.equal(topp?.via, 'Holding AB');
  assert.equal(topp?.level, 2);
  assert.match(topped.standalone.detail, /Topp AB \(äger 80 % av Holding AB, genom Holding AB\)/);
  // Topp AB (2006) fäller art. 22 för hela koncernen — det var Combly-fallet, nu en nivå ned.
  assert.equal(topped.stateAid.outcome, 'de_minimis');
});

test('sameOwnershipPicture: grundarholding = samma personer och andelar; investerare eller andra personer = olika', () => {
  const subject = company({
    orgNr: '5595728790',
    name: 'Workify AB',
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5592581416', name: 'Holding AB', capital_pct: 100, part: 'group_structure' },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50, indirect: true, part: 'beneficial_owners' },
      { direction: 'owner', owner_kind: 'person', pct_min: 50, pct_max: 75, indirect: true, part: 'beneficial_owners' }
    ]
  });
  const sameHolding = company({
    orgNr: '5592581416',
    name: 'Holding AB',
    ownership: [
      { direction: 'holding', owner_kind: 'company', org_nr: '5595728790', name: 'Workify AB', capital_pct: 100 },
      { direction: 'owner', owner_kind: 'person', pct_min: 50, pct_max: 75 },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 }
    ]
  });
  assert.equal(sameOwnershipPicture(subject, sameHolding).same, true);
  const investorHolding = company({
    orgNr: '5592581416',
    name: 'Holding AB',
    ownership: [
      { direction: 'owner', owner_kind: 'investor', name: 'VC Fond', capital_pct: 30 },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 }
    ]
  });
  const inv = sameOwnershipPicture(subject, investorHolding);
  assert.equal(inv.same, false);
  assert.match(inv.reason, /VC Fond/);
  const otherPersons = company({
    orgNr: '5592581416',
    name: 'Holding AB',
    ownership: [{ direction: 'owner', owner_kind: 'person', capital_pct: 100 }]
  });
  assert.equal(sameOwnershipPicture(subject, otherPersons).same, false);
  // Inte hämtad verklig huvudman ⇒ kan inte jämföras.
  assert.equal(sameOwnershipPicture(subject, company({ orgNr: '5592581416', beneficialOwnersFetched: false })).same, null);
  // Syns i bedömningen på ägarbolaget.
  const res = screenExcellence(input({ subject, related: [investorHolding] }));
  assert.equal(res.companies[1].ownersMatchSubject?.same, false);
  // Nivå 2-referenser bär viaOrgNr så servern kan stoppa expansion genom bolaget.
  const refs = deriveGroupCompanies(subject, [investorHolding]);
  assert.equal(refs.find((r) => r.name === 'VC Fond')?.viaOrgNr, '5592581416');
=======
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
>>>>>>> origin/staging
});
