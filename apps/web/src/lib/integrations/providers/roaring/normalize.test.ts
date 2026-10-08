import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRecordKeys,
  normalizeRoaringBeneficialOwners,
  normalizeRoaringCompany,
  normalizeRoaringFinancials,
  normalizeRoaringGroupStructure,
  normalizeRoaringOverview,
  parseRoaringPathList,
  roaringReportsNoRecords
} from './normalize';

// Fixturer i Roarings `{ records: [ … ] }`-form. Fältnamnen är de vi
// förväntar oss; normaliseraren läser kandidatlistor så en avvikande version
// ger `notes`, aldrig fel data.

const overview = {
  records: [
    {
      companyId: '5595728790',
      companyName: 'Combly AB',
      companyRegistrationDate: '2026-02-17',
      legalGroupCode: 'AB',
      legalGroupText: 'Aktiebolag',
      industryCode: '62010',
      industryText: 'Dataprogrammering',
      statusTextHigh: 'Aktivt',
      statusTextDetailed: 'Bolaget är aktivt',
      commune: 'Gävle',
      postalAddress: { town: 'GÄVLE' }
    }
  ]
};

test('overview → bolagskortets registerfält', () => {
  const notes: string[] = [];
  const { name, patch } = normalizeRoaringOverview(overview, notes);
  assert.equal(name, 'Combly AB');
  assert.equal(patch.bolagsform, 'Aktiebolag');
  assert.equal(patch.kommun, 'Gävle');
  assert.equal(patch.sni_code, '62010');
  assert.equal(patch.industri, 'Dataprogrammering');
  assert.equal(patch.bolag_status, 'aktiv');
  assert.equal(patch.company_registered_at, '2026-02-17');
  assert.deepEqual(notes, []);
});

test('overview: tomt svar ger notes, inget patch', () => {
  const notes: string[] = [];
  const { patch } = normalizeRoaringOverview({ records: [] }, notes);
  assert.deepEqual(patch, {});
  assert.ok(notes.some((n) => n.includes('tomt svar')));
});

test('bokslut: TSEK → SEK, balansomslutning och eget kapital', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringFinancials(
    {
      records: [
        {
          companyId: '5567036271',
          companyAccounts: [
            { toDate: '2024-12-31', plNetOperatingIncome: 141, bsTotalAssets: 1100, bsTotalEquity: 400, nbrOfEmployees: 2, plNetProfitLoss: -12 },
            { toDate: '2023-12-31', plNetOperatingIncome: 90, bsTotalAssets: 900, nbrOfEmployees: 1 }
          ]
        }
      ]
    },
    notes,
    1000
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].year, 2023);
  assert.equal(rows[1].year, 2024);
  assert.equal(rows[1].revenue_sek, 141_000);
  assert.equal(rows[1].balance_sheet_sek, 1_100_000);
  assert.equal(rows[1].equity_sek, 400_000);
  assert.equal(rows[1].net_result_sek, -12_000);
  assert.equal(rows[1].employees, 2);
  assert.ok(notes.some((n) => n.includes('1000')));
});

test('bokslut: saknad balansomslutning rapporteras i notes', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringFinancials({ records: [{ toDate: '2024-12-31', netTurnover: 5 }] }, notes, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance_sheet_sek, undefined);
  assert.ok(notes.some((n) => n.includes('balansomslutning')));
});

test('koncernstruktur: bolaget hittas i trädet → direkt/indirekt ägare + innehav', () => {
  const notes: string[] = [];
  const tree = {
    records: [
      {
        companyId: '5567036271',
        companyName: 'Ewell AB',
        groupCompanies: [
          {
            companyId: '5594427808',
            companyName: 'Wellgo Health AB',
            ownedPercentage: 90,
            groupCompanies: [
              { companyId: '5595728790', companyName: 'Combly AB', ownedPercentage: 100, groupCompanies: [
                { companyId: '5594429630', companyName: 'Dotter AB', ownedPercentage: 51 }
              ] }
            ]
          }
        ]
      }
    ]
  };
  const rows = normalizeRoaringGroupStructure(tree, '559572-8790', notes);
  const owners = rows.filter((r) => r.direction === 'owner');
  const holdings = rows.filter((r) => r.direction === 'holding');
  assert.equal(owners.length, 2);
  const direct = owners.find((o) => o.org_nr === '5594427808');
  assert.ok(direct);
  assert.equal(direct?.capital_pct, 100);
  assert.equal(direct?.indirect, undefined);
  const indirect = owners.find((o) => o.org_nr === '5567036271');
  assert.equal(indirect?.indirect, true);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].org_nr, '5594429630');
  assert.equal(holdings[0].capital_pct, 51);
});

test('koncernstruktur: fristående bolag ger inga rader men en not', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    { records: [{ companyId: '5595728790', companyName: 'Combly AB', groupCompanies: [] }] },
    '5595728790',
    notes
  );
  assert.equal(rows.length, 0);
  assert.ok(notes.some((n) => n.includes('fristående')));
});

test('verklig huvudman: anonyma person-rader — aldrig namn eller personnummer', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      records: [
        {
          companyId: '5595728790',
          beneficialOwners: [
            { firstName: 'Johan', surName: 'Testsson', personalNumber: '198001011234', ownershipPercentInterval: '25-50', votesPercentInterval: '25-50', controlType: 'Äger aktier' },
            { firstName: 'Cecilia', surName: 'Testsson', personalNumber: '198202022345', ownershipPercentInterval: '>75' }
          ]
        }
      ]
    },
    notes
  );
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.owner_kind, 'person');
    assert.equal(r.name, undefined);
    assert.equal(r.org_nr, undefined);
    const json = JSON.stringify(r);
    assert.ok(!json.includes('Testsson'));
    assert.ok(!json.includes('19800101'));
  }
  assert.equal(rows[0].pct_min, 25);
  assert.equal(rows[0].pct_max, 50);
  assert.equal(rows[0].control_basis, 'shares');
  assert.equal(rows[1].pct_min, 75);
  assert.equal(rows[1].pct_max, 100);
});

test('normalizeRoaringCompany: enskild firma får ingen ägarbild', () => {
  const company = normalizeRoaringCompany(
    '8501011234',
    {
      overview,
      beneficialOwners: { records: [{ beneficialOwners: [{ firstName: 'X', ownershipPercentInterval: '>75' }] }] }
    },
    { isPersonal: true }
  );
  assert.equal(company.isPersonal, true);
  assert.equal(company.ownership.length, 0);
  assert.equal(company.startup.bolagsform, 'Aktiebolag');
});

test('normalizeRoaringCompany: samlar notes från alla delar', () => {
  const company = normalizeRoaringCompany('5595728790', { overview: { records: [] }, financials: { records: [] } }, { isPersonal: false });
  assert.ok(company.notes.length >= 2);
  assert.deepEqual(company.startup, {});
});

test('koncernstruktur: nod utan org-nr eller med personnummer-derivat blir anonym person', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    {
      records: [
        {
          companyId: '5595728790',
          companyName: 'Combly AB',
          owners: [
            { companyName: 'Anna Testsson', ownedPercentage: 45 },
            { companyId: '8501011234', companyName: 'Annas Firma', ownedPercentage: 10 },
            { companyId: '5594427808', companyName: 'Wellgo Health AB', ownedPercentage: 45 }
          ]
        }
      ]
    },
    '5595728790',
    notes
  );
  assert.equal(rows.length, 3);
  const persons = rows.filter((r) => r.owner_kind === 'person');
  assert.equal(persons.length, 2);
  for (const p of persons) {
    assert.equal(p.name, undefined);
    assert.equal(p.org_nr, undefined);
  }
  assert.ok(!JSON.stringify(rows).includes('Testsson'));
  assert.ok(!JSON.stringify(rows).includes('8501011234'));
  assert.equal(rows.find((r) => r.owner_kind === 'company')?.org_nr, '5594427808');
});

test('verklig huvudman: kontrollgrund mappas till fast vokabulär, aldrig fritext', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      records: [
        {
          beneficialOwners: [
            { controlType: 'Kontroll via avtal med Johan Testsson', ownershipPercentInterval: '25-50' },
            { controlType: 'Rätt att utse styrelse', ownershipPercentInterval: '<25' },
            { companyId: '8501011234', companyName: 'Enskild Firma', ownershipPercentInterval: '>75' }
          ]
        }
      ]
    },
    notes
  );
  assert.equal(rows[0].control_basis, 'agreement');
  assert.equal(rows[1].control_basis, 'board');
  assert.equal(rows[2].owner_kind, 'person');
  assert.equal(rows[2].name, undefined);
  assert.ok(!JSON.stringify(rows).includes('Testsson'));
});

test('parseRoaringPathList: env-kandidater i ordning, fallback vid tom/ogiltig', () => {
  assert.deepEqual(parseRoaringPathList(undefined, ['/a/1.0']), ['/a/1.0']);
  assert.deepEqual(parseRoaringPathList('  ', ['/a/1.0']), ['/a/1.0']);
  assert.deepEqual(parseRoaringPathList('/se/beneficialowner/2.1/, /se/company/beneficial-owner/1.0', ['/x']), [
    '/se/beneficialowner/2.1',
    '/se/company/beneficial-owner/1.0'
  ]);
  // Relativa/absoluta URL:er släpps aldrig igenom — bara sökvägar mot bas-URL:en.
  assert.deepEqual(parseRoaringPathList('https://evil.example/x, se/company', ['/a/1.0']), ['/a/1.0']);
});

test('describeRecordKeys: bara fältnycklar, aldrig värden', () => {
  const keys = describeRecordKeys({
    records: [
      {
        companyId: '5595728790',
        companyName: 'Combly AB',
        postalAddress: { town: 'GÄVLE', zipCode: '80320' },
        beneficialOwners: [{ extentOfOwnership: '25-50', name: 'HEMLIG' }],
        empty: []
      }
    ]
  });
  assert.deepEqual(keys, [
    'companyId',
    'companyName',
    'postalAddress{town,zipCode}',
    'beneficialOwners[extentOfOwnership,name]',
    'empty[]'
  ]);
  assert.ok(!keys.join(' ').includes('HEMLIG'));
  assert.ok(!keys.join(' ').includes('Combly'));
  assert.deepEqual(describeRecordKeys({ records: [] }), []);
});

test('verklig huvudman: hasBeneficialOwners=false ger tydlig not', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    { records: [{ companyId: '5595728790', hasBeneficialOwners: false, beneficialOwners: [] }] },
    notes
  );
  assert.equal(rows.length, 0);
  assert.ok(notes.some((n) => n.includes('hasBeneficialOwners=false')));
});

// Roarings svenska koncernstruktur är en PLATT lista (se-company-group-
// structure-1.0): groupCompanies[] med motherCompanyId/ownedPercentage/
// companyLevel, kuvertet är det frågade bolaget.

test('koncernstruktur (platt): bolaget är moderbolag → bara innehav', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    {
      companyId: '5595728790',
      companyName: 'Combly AB',
      countryCode: 'SE',
      status: { code: 100, text: 'Aktivt' },
      groupCompanies: [
        { companyId: '5594429630', companyName: 'Dotter AB', countryCode: 'SE', companyLevel: 1, motherCompanyId: '5595728790', ownedPercentage: 100 },
        { companyId: '5566778899', companyName: 'Halvägd AB', countryCode: 'SE', companyLevel: 1, motherCompanyId: '5595728790', ownedPercentage: 51 }
      ]
    },
    '559572-8790',
    notes
  );
  assert.equal(rows.filter((r) => r.direction === 'owner').length, 0);
  const holdings = rows.filter((r) => r.direction === 'holding');
  assert.deepEqual(
    holdings.map((h) => [h.org_nr, h.capital_pct]).sort(),
    [['5566778899', 51], ['5594429630', 100]]
  );
});

test('koncernstruktur (platt): dotterbolag → ägarkedja uppåt, syskon räknas inte', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    {
      companyId: '5595728790',
      companyName: 'Combly AB',
      groupCompanies: [
        { companyId: '5567036271', companyName: 'Ewell AB', companyLevel: 0 },
        { companyId: '5594427808', companyName: 'Wellgo Health AB', companyLevel: 1, motherCompanyId: '5567036271', ownedPercentage: 90 },
        { companyId: '5595728790', companyName: 'Combly AB', companyLevel: 2, motherCompanyId: '5594427808', ownedPercentage: 100 },
        { companyId: '5566778899', companyName: 'Syskon AB', companyLevel: 2, motherCompanyId: '5594427808', ownedPercentage: 100 },
        { companyId: '5594429630', companyName: 'Dotter AB', companyLevel: 3, motherCompanyId: '5595728790', ownedPercentage: 51 }
      ]
    },
    '5595728790',
    notes
  );
  const owners = rows.filter((r) => r.direction === 'owner');
  const holdings = rows.filter((r) => r.direction === 'holding');
  const direct = owners.find((o) => o.org_nr === '5594427808');
  assert.equal(direct?.capital_pct, 100, 'moderns andel står på bolagets egen post');
  assert.equal(direct?.indirect, undefined);
  const top = owners.find((o) => o.org_nr === '5567036271');
  assert.equal(top?.indirect, true);
  assert.equal(top?.capital_pct, undefined);
  assert.equal(owners.length, 2);
  assert.deepEqual(holdings.map((h) => [h.org_nr, h.capital_pct]), [['5594429630', 51]]);
  assert.ok(!rows.some((r) => r.org_nr === '5566778899'), 'syskonbolaget är varken ägare eller innehav');
});

test('records not found i kuvertet tolkas som "inga uppgifter" — bolagets egen status gör det inte', () => {
  assert.equal(roaringReportsNoRecords({ status: { code: 1, text: 'records not found' }, records: [] }), true);
  assert.equal(roaringReportsNoRecords({ responseInfo: { statusText: 'No records found' } }), true);
  assert.equal(roaringReportsNoRecords(overview), false);
  assert.equal(
    roaringReportsNoRecords({ companyId: '5595728790', status: { code: 100, text: 'Aktivt' }, groupCompanies: [] }),
    false
  );
  assert.equal(roaringReportsNoRecords(null), false);
});

test('verklig huvudman: intervall som objekt och kontrollgrund som kodlista', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      companyId: '5595728790',
      hasBeneficialOwners: true,
      beneficialOwners: [
        {
          personalNumber: '198001011234',
          firstName: 'Johan',
          extentOfControl: { from: 25, to: 50 },
          controlTypes: [{ code: 'X1', text: 'Äger aktier i bolaget' }]
        }
      ]
    },
    notes
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pct_min, 25);
  assert.equal(rows[0].pct_max, 50);
  assert.equal(rows[0].control_basis, 'shares');
  assert.ok(!JSON.stringify(rows[0]).includes('Johan'));
  assert.ok(!JSON.stringify(rows[0]).includes('198001011234'));
});
