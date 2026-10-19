import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRecordKeys,
  describeShape,
  parseControlInterval,
  normalizeRoaringBeneficialOwners,
  normalizeRoaringCompany,
  normalizeRoaringFinancials,
  normalizeRoaringGroupMembers,
  normalizeRoaringGroupStructure,
  normalizeRoaringOverview,
  normalizeRoaringPersonEngagements,
  normalizeRoaringSni,
  normalizePersonalNumber,
  parseRoaringPathList,
  roaringBeneficialOwnerPersons,
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

test('verklig huvudman: person-rader med transient namn — aldrig personnummer eller name/org_nr', () => {
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
    assert.ok(!json.includes('19800101'));
    assert.ok(!json.includes('19820202'));
  }
  // Namnet visas transient (§ 51.7) — bara för-/efternamn.
  assert.equal(rows[0].person_name, 'Johan Testsson');
  assert.equal(rows[1].person_name, 'Cecilia Testsson');
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

test('koncernstruktur: nod utan org-nr eller med personnummer-derivat blir person med namn men utan org-nr', () => {
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
  // Ägarbilden ska gå att läsa (§ 51.11): namnet följer med, personnumret aldrig.
  assert.deepEqual(persons.map((p) => p.person_name).sort(), ['Anna Testsson', 'Annas Firma']);
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
  // Namnet följer med transient (§ 51.7); personnumret aldrig.
  assert.ok(!JSON.stringify(rows[0]).includes('198001011234'));
});

test('koncernstruktur (platt): moderbolag med bolagsnamn men id i okänt format behålls som bolag utan org-nr', () => {
  // Incident 2026-10: Wellgo Health AB försvann ur screeningen som "Fysisk
  // person 100 %" när moderns id inte kunde tolkas som org-nr.
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    {
      records: [
        {
          groupCompanies: [
            { companyId: 'SE-WELLGO-001', companyName: 'Wellgo Health AB', companyLevel: 0 },
            { companyId: '5595728790', companyName: 'Combly AB', motherCompanyId: 'SE-WELLGO-001', ownedPercentage: 100, companyLevel: 1 }
          ]
        }
      ]
    },
    '5595728790',
    notes
  );
  const owner = rows.find((r) => r.direction === 'owner');
  assert.ok(owner, 'moderbolaget ska finnas som ägare');
  assert.equal(owner.owner_kind, 'company');
  assert.equal(owner.name, 'Wellgo Health AB');
  assert.equal(owner.org_nr, undefined);
  assert.equal(owner.capital_pct, 100);
  const json = JSON.stringify(notes);
  assert.ok(json.includes('okänt format'), 'formen ska noteras');
  assert.ok(!json.includes('SE-WELLGO-001'), 'aldrig själva id-värdet i noten');
});

test('koncernstruktur: personnummer-derivat blir person ÄVEN med bolagsliknande namn (aldrig org-nr)', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(
    {
      records: [
        {
          companyId: '5595728790',
          companyName: 'Combly AB',
          owners: [{ companyId: '8501011234', companyName: 'Annas Firma AB', ownedPercentage: 30 }]
        }
      ]
    },
    '5595728790',
    notes
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_kind, 'person');
  assert.equal(rows[0].name, undefined);
  assert.equal(rows[0].person_name, 'Annas Firma AB');
  assert.ok(!JSON.stringify(rows).includes('8501011234'));
});

test('verklig huvudman: juridisk person med id i okänt format behålls som bolag utan org-nr', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      records: [
        {
          companyId: '5595728790',
          beneficialOwners: [
            { companyId: 'X-123', companyName: 'Wellgo Health AB', ownershipPercentInterval: '>75', controlType: 'Äger aktier' },
            { firstName: 'Johan', surName: 'Testsson', personalNumber: '198001011234', ownershipPercentInterval: '25-50' }
          ]
        }
      ]
    },
    notes
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].owner_kind, 'company');
  assert.equal(rows[0].name, 'Wellgo Health AB');
  assert.equal(rows[0].org_nr, undefined);
  assert.equal(rows[0].pct_min, 75);
  assert.equal(rows[1].owner_kind, 'person');
  assert.equal(rows[1].name, undefined);
  assert.equal(rows[1].person_name, 'Johan Testsson');
  assert.ok(!JSON.stringify(rows).includes('198001011234'));
  assert.ok(!JSON.stringify(notes).includes('X-123'));
});

test('bokslut (economy-overview 2.1): balansomslutning läses ur bsTotalEquityAndLiabilities, omsättning ur plSales', () => {
  // Fältnycklar bekräftade mot ett riktigt svar 2026-10-12 (Workify Sverige AB).
  const notes: string[] = [];
  const rows = normalizeRoaringFinancials(
    {
      records: [
        {
          companyId: '5591234567',
          fromDate: '2024-01-01',
          toDate: '2024-12-31',
          currency: 'SEK',
          numberOfEmployees: 3,
          plNetOperatingIncome: 1250,
          plSales: 1200,
          plEbit: -40,
          plNetProfitLoss: -55,
          bsTotalEquity: 310,
          bsTotalLongTermDebts: 0,
          bsTotalCurrentLiabilities: 190,
          bsTotalEquityAndLiabilities: 500
        }
      ]
    },
    notes,
    1000
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance_sheet_sek, 500_000);
  assert.equal(rows[0].revenue_sek, 1_200_000);
  assert.equal(rows[0].equity_sek, 310_000);
  assert.equal(rows[0].net_result_sek, -55_000);
  assert.equal(rows[0].employees, 3);
  assert.ok(!notes.some((n) => n.includes('balansomslutning saknas')), 'får inte längre noteras som saknad');
  assert.ok(notes.some((n) => n.includes('plNetOperatingIncome') && n.includes('avvek')), 'avvikelsen ska noteras');
});

test('bokslut: ingen avvikelse-not när plSales och plNetOperatingIncome är lika', () => {
  const notes: string[] = [];
  normalizeRoaringFinancials(
    { records: [{ toDate: '2024-12-31', plSales: 100, plNetOperatingIncome: 100, bsTotalEquityAndLiabilities: 50 }] },
    notes,
    1
  );
  assert.ok(!notes.some((n) => n.includes('avvek')));
});

test('verklig huvudman (2.1): extentOfControl i ord och controlTypes som kodlista — ur person-objektet läses BARA namnet', () => {
  // Formen bekräftad 2026-10-12: beneficialOwners[person,extentOfControl,controlTypes].
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      records: [
        {
          caseId: 'C-1',
          legalEntity: { type: 'COMPANY', companyId: '5591234567', companyName: 'Workify Sverige AB' },
          beneficialOwners: [
            {
              person: { firstName: 'Anna', lastName: 'Testsson', personalNumber: '198001011234', birthDate: '1980-01-01' },
              extentOfControl: { code: 'MORE_THAN_75', text: 'Mer än 75 procent' },
              controlTypes: [{ code: 'OWNS_SHARES', text: 'Äger aktier i bolaget' }]
            },
            {
              person: { firstName: 'Bo', lastName: 'Testsson' },
              extentOfControl: 'More than 25% but not more than 50%',
              controlTypes: ['BOARD']
            }
          ],
          status: { code: 'OK', description: 'ok' }
        }
      ]
    },
    notes
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].owner_kind, 'person');
  assert.equal(rows[0].pct_min, 75);
  assert.equal(rows[0].pct_max, 100);
  assert.equal(rows[0].control_basis, 'shares');
  assert.equal(rows[1].pct_min, 25);
  assert.equal(rows[1].pct_max, 50);
  assert.equal(rows[1].control_basis, 'board');
  // Namnet visas transient på skärmen (§ 51.7); personnummer/födelsedatum läses aldrig.
  assert.equal(rows[0].person_name, 'Anna Testsson');
  assert.equal(rows[1].person_name, 'Bo Testsson');
  const json = JSON.stringify({ rows, notes });
  for (const pii of ['198001011234', '1980-01-01']) assert.ok(!json.includes(pii), pii);
  assert.ok(!JSON.stringify(notes).includes('Testsson'));
  assert.ok(!notes.some((n) => n.includes('kunde inte tolkas')));
});

test('verklig huvudman: otolkbart intervall noteras med FORM, aldrig värde', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringBeneficialOwners(
    {
      records: [
        {
          beneficialOwners: [{ person: { firstName: 'Anna' }, extentOfControl: { level: 'HEMLIG-KOD-99' }, controlTypes: [] }]
        }
      ]
    },
    notes
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pct_min, undefined);
  const note = notes.find((n) => n.includes('kontrollintervall kunde inte tolkas'));
  assert.ok(note, 'ska noteras');
  assert.ok(note.includes('extentOfControl{level}'));
  assert.ok(!JSON.stringify(notes).includes('HEMLIG'));
  assert.ok(!JSON.stringify(notes).includes('Anna'));
});

test('describeRecordKeys visar formen två nivåer ned i listor', () => {
  const keys = describeRecordKeys({
    records: [
      {
        beneficialOwners: [
          { person: { firstName: 'Anna' }, extentOfControl: { code: 'X', text: 'Y' }, controlTypes: [{ code: 'A' }] }
        ],
        status: { code: 'OK' }
      }
    ]
  });
  assert.deepEqual(keys, ['beneficialOwners[person{firstName},extentOfControl{code,text},controlTypes[code]]', 'status{code}']);
  assert.ok(!JSON.stringify(keys).includes('Anna'));
  assert.equal(describeShape('x', [{ a: { b: { c: 1 } } }], 2), 'x[a{b{…}}]');
  assert.equal(describeShape('x', 'str', 2), 'x');
});

test('parseControlInterval garderar mot alla rimliga former av extentOfControl', () => {
  const cases: [unknown, { min: number; max: number } | undefined][] = [
    ['Mer än 25 men inte mer än 50 procent', { min: 25, max: 50 }],
    ['MER_AN_75', { min: 75, max: 100 }],
    ['MER_AN_25_MEN_INTE_MER_AN_50', { min: 25, max: 50 }],
    ['OVER_75', { min: 75, max: 100 }],
    ['GT75', { min: 75, max: 100 }],
    ['LT25', { min: 0, max: 25 }],
    ['GTE_25_LTE_50', { min: 25, max: 50 }],
    ['MORE_THAN_50_LESS_THAN_75', { min: 50, max: 75 }],
    [75, { min: 75, max: 75 }],
    [{ code: 'MORE_THAN_75' }, { min: 75, max: 100 }],
    [{ code: 'X9', description: 'Mer än 50 % men inte mer än 75 %' }, { min: 50, max: 75 }],
    [{ code: '3', text: 'Over 75 percent' }, { min: 75, max: 100 }],
    [{ percentFrom: 25, percentTo: 50 }, { min: 25, max: 50 }],
    [{ low: 50, high: 75 }, { min: 50, max: 75 }],
    [{ minimum: 75 }, { min: 75, max: 100 }],
    [{ interval: { from: 25, to: 50 } }, { min: 25, max: 50 }],
    [{ ownership: { code: 'MORE_THAN_25_LESS_THAN_50' } }, { min: 25, max: 50 }],
    [{ extentOfControlCode: 'MER_AN_75', changeDate: '2024-01-15' }, { min: 75, max: 100 }],
    [[{ code: 'MORE_THAN_75' }], { min: 75, max: 100 }],
    [{ changeDate: '2024-01-15', caseId: '20240115001' }, undefined],
    ['Okänd omfattning', undefined],
    [null, undefined]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(parseControlInterval(input), expected, JSON.stringify(input));
  }
});

test('verklig huvudman: kontrollgrund ur { code, description }, kodlista och objekt som bär listan', () => {
  const run = (controlTypes: unknown) => {
    const notes: string[] = [];
    const rows = normalizeRoaringBeneficialOwners(
      { records: [{ beneficialOwners: [{ person: { firstName: 'Anna' }, extentOfControl: 'MORE_THAN_75', controlTypes }] }] },
      notes
    );
    return rows[0]?.control_basis;
  };
  assert.equal(run([{ code: '1', description: 'Äger aktier i bolaget' }]), 'shares');
  assert.equal(run([{ code: 'VOTES' }]), 'votes');
  assert.equal(run(['BOARD_APPOINTMENT']), 'board');
  assert.equal(run('Kontroll genom avtal'), 'agreement');
  assert.equal(run({ types: [{ code: 'OWNS_SHARES' }] }), 'shares');
  // Flera grunder: en okänd först får inte skugga en känd.
  assert.equal(run([{ code: 'Z' }, { code: 'OWNS_SHARES' }]), 'shares');
  assert.equal(run([{ code: 'Z' }]), 'other');
});

test('bokslut (/extended): dividend, plPersonalCosts och plTaxes läses exakt enligt specen — 0 kr utdelning är ett svar', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringFinancials(
    {
      records: [
        { companyId: '5595728790', fromDate: '2023-01-01', toDate: '2023-12-31', plSales: 100, plPersonalCosts: -820, plTaxes: -12, dividend: 0 },
        { companyId: '5595728790', fromDate: '2024-01-01', toDate: '2024-12-31', plSales: 400, dividend: 150 }
      ],
      status: { code: 0, text: 'found' }
    },
    notes,
    1000
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].year, 2023);
  assert.equal(rows[0].dividend_sek, 0);
  assert.equal(rows[0].dividend_reported, true);
  assert.equal(rows[0].personnel_cost_sek, 820_000);
  assert.equal(rows[0].corporate_tax_sek, 12_000);
  assert.equal(rows[1].dividend_sek, 150_000);
  assert.equal(rows[1].dividend_reported, true);
  assert.ok(!notes.some((n) => n.includes('utdelningsposten')));
});

test('bokslut utan dividend-nyckel (naken /{companyId}) lämnar utdelningen OKÄND och noterar det', () => {
  const notes: string[] = [];
  const rows = normalizeRoaringFinancials({ records: [{ toDate: '2024-12-31', plSales: 50, plNetProfitLoss: 5 }] }, notes, 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dividend_reported, undefined);
  assert.equal(rows[0].dividend_sek, undefined);
  assert.ok(notes.some((n) => n.includes('utdelningsposten')));
});


test('koncernstruktur (platt): hela koncernen exporteras — moder, syskon och dotter med moder/andel/nivå', () => {
  const members = normalizeRoaringGroupMembers(
    {
      companyId: '5595728790',
      companyName: 'Combly AB',
      groupCompanies: [
        { companyId: '5567036271', companyName: 'Ewell AB', companyLevel: 0 },
        { companyId: '5594427808', companyName: 'Wellgo Health AB', companyLevel: 1, motherCompanyId: '5567036271', ownedPercentage: 90 },
        { companyId: '5595728790', companyName: 'Combly AB', companyLevel: 2, motherCompanyId: '5594427808', ownedPercentage: 100 },
        { companyId: '5566778899', companyName: 'Syskon AB', companyLevel: 2, motherCompanyId: '5594427808', ownedPercentage: 100 },
        { companyId: '195001011234', companyName: 'Enskild firma', companyLevel: 2, motherCompanyId: '5594427808', ownedPercentage: 100 },
        { companyId: '5594429630', companyName: 'Dotter AB', companyLevel: 3, motherCompanyId: '5595728790', ownedPercentage: 51 }
      ]
    },
    '559572-8790'
  );
  assert.ok(members);
  assert.deepEqual(
    members.map((m) => [m.org_nr, m.level, m.mother_org_nr, m.mother_name, m.owned_pct]),
    [
      ['5567036271', 0, undefined, undefined, undefined],
      ['5594427808', 1, '5567036271', 'Ewell AB', 90],
      ['5595728790', 2, '5594427808', 'Wellgo Health AB', 100],
      ['5566778899', 2, '5594427808', 'Wellgo Health AB', 100],
      ['5594429630', 3, '5595728790', 'Combly AB', 51]
    ]
  );
  assert.ok(!JSON.stringify(members).includes('195001011234'), 'personnummer-derivat lämnar aldrig normaliseraren');
  // Hela kedjan följer med in i RegistryCompany.group bara när koncernstrukturen hämtats.
  const company = normalizeRoaringCompany('5595728790', { groupStructure: { companyId: '5595728790', groupCompanies: [{ companyId: '5594427808', companyName: 'Wellgo Health AB', companyLevel: 0 }, { companyId: '5595728790', companyName: 'Combly AB', companyLevel: 1, motherCompanyId: '5594427808', ownedPercentage: 100 }] } }, { isPersonal: false });
  assert.equal(company.group?.length, 2);
  assert.equal(normalizeRoaringCompany('5595728790', {}, { isPersonal: false }).group, undefined);
  assert.equal(normalizeRoaringGroupMembers({ companyId: '5595728790', owners: [] }, '5595728790'), undefined);
});

test('koncernstruktur (platt): moder med bolagsnamn men okänt id-format blir medlem utan org-nr, och barnets mother_name sätts', () => {
  const members = normalizeRoaringGroupMembers(
    { records: [{ groupCompanies: [
      { companyId: 'SE-WELLGO-001', companyName: 'Wellgo Health AB', companyLevel: 0 },
      { companyId: '5595728790', companyName: 'Combly AB', motherCompanyId: 'SE-WELLGO-001', ownedPercentage: 100, companyLevel: 1 }
    ] }] },
    '5595728790'
  );
  assert.ok(members);
  assert.deepEqual(members[0], { name: 'Wellgo Health AB', level: 0 });
  assert.equal(members[1].mother_name, 'Wellgo Health AB');
  assert.equal(members[1].mother_org_nr, undefined);
});

test('koncernstruktur (platt): avvikande nycklar (nästlad lista, parentCompanyId, organisationNumber) ger ändå hela koncernen', () => {
  const raw = {
    records: [
      {
        organisationNumber: '5595728790',
        companyName: 'Combly AB',
        groupStructure: {
          companies: [
            { organisationNumber: '5567036271', name: 'Ewell AB', level: 0 },
            { organisationNumber: '5594427808', name: 'Wellgo Health AB', level: 1, parentCompanyId: '5567036271', ownedPercentage: 90 },
            { organisationNumber: '5595728790', name: 'Combly AB', level: 2, parentCompanyId: '5594427808', ownedPercentage: 100 }
          ]
        }
      }
    ]
  };
  const members = normalizeRoaringGroupMembers(raw, '5595728790');
  assert.ok(members);
  assert.deepEqual(
    members.map((m) => [m.org_nr, m.mother_org_nr, m.owned_pct]),
    [
      ['5567036271', undefined, undefined],
      ['5594427808', '5567036271', 90],
      ['5595728790', '5594427808', 100]
    ]
  );
  const notes: string[] = [];
  const rows = normalizeRoaringGroupStructure(raw, '5595728790', notes);
  assert.deepEqual(rows.filter((r) => r.direction === 'owner').map((r) => [r.org_nr, r.capital_pct, r.indirect]), [
    ['5594427808', 100, undefined],
    ['5567036271', undefined, true]
  ]);
});

// ─── Ägarnas andra bolag + SNI (§ 51.11) ───────────────────────────────────

test('SNI: huvudsaklig kod först + övriga ur listan, dubbletter och 00000 släpps', () => {
  const list = normalizeRoaringSni({
    industryCode: '62010',
    industryText: 'Dataprogrammering',
    industries: [{ code: '70220', text: 'Konsultverksamhet' }, { code: '62010' }, '00000', { sniCode: '58290', description: 'Utgivning av annan programvara' }]
  });
  assert.deepEqual(list, [
    { code: '62010', text: 'Dataprogrammering', primary: true },
    { code: '70220', text: 'Konsultverksamhet' },
    { code: '58290', text: 'Utgivning av annan programvara' }
  ]);
  const notes: string[] = [];
  const ov = normalizeRoaringOverview({ records: [{ companyName: 'X AB', companyRegistrationDate: '2020-01-01', statusTextHigh: 'Aktiv' }] }, notes);
  assert.deepEqual(ov.sni, []);
  assert.ok(notes.some((n) => n.includes('SNI-kod saknas')));
});

test('normalizeRoaringCompany: SNI-listan följer med när grunddata hämtades', () => {
  const c = normalizeRoaringCompany('5595728790', { overview }, { isPersonal: false });
  assert.equal(c.sni?.[0].code, '62010');
  assert.equal(c.sni?.[0].primary, true);
});

test('normalizePersonalNumber: 10/12 siffror med Luhn, samordningsnummer, annat avvisas', () => {
  assert.equal(normalizePersonalNumber('19800101-1234'), null); // fel kontrollsiffra
  assert.equal(normalizePersonalNumber('198112189876'), '198112189876');
  assert.equal(normalizePersonalNumber('811218-9876'), '8112189876');
  assert.equal(normalizePersonalNumber('5595728790'), null); // org-nr (månad 95)
  assert.equal(normalizePersonalNumber('abc'), null);
});

test('roaringBeneficialOwnerPersons: personnumret läses för sökningen, juridiska personer utelämnas', () => {
  const persons = roaringBeneficialOwnerPersons({
    records: [
      {
        beneficialOwners: [
          { person: { firstName: 'Anna', lastName: 'Testsson', personalNumber: '198112189876' }, extentOfControl: 'Mer än 75 procent' },
          { person: { firstName: 'Bo', lastName: 'Utan' }, extentOfControl: '25-50' },
          { companyId: '5594427808', companyName: 'Wellgo Health AB', extentOfControl: '>75' }
        ]
      }
    ]
  });
  assert.equal(persons.length, 2);
  assert.equal(persons[0].name, 'Anna Testsson');
  assert.equal(persons[0].personalNumber, '198112189876');
  assert.equal(persons[0].pct_min, 75);
  assert.equal(persons[1].personalNumber, undefined);
  assert.ok(persons[1].shape?.includes('firstName'));
});

test('verklig huvudman per person: både "post per bolag" och "lista per person" tolkas; personens andel hittas', () => {
  const notes: string[] = [];
  // Post per bolag, andelen i bolagets huvudmannalista matchad på personnumret.
  const a = normalizeRoaringPersonEngagements(
    {
      records: [
        {
          legalEntity: { companyId: '5567036271', companyName: 'Ewell AB' },
          beneficialOwners: [
            { person: { personalNumber: '196001011234' }, extentOfControl: '25-50' },
            { person: { personalNumber: '198112189876' }, extentOfControl: 'Mer än 75 procent', controlTypes: ['Äger aktier'] }
          ]
        },
        { legalEntity: { companyId: '8112189876', companyName: 'Annas Firma' }, extentOfControl: '>75' }
      ]
    },
    '198112189876',
    notes
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].org_nr, '5567036271');
  assert.equal(a[0].name, 'Ewell AB');
  assert.equal(a[0].pct_min, 75);
  assert.equal(a[0].control_basis, 'shares');
  assert.ok(notes.some((n) => n.includes('enskild')));
  assert.ok(!JSON.stringify(a).includes('198112189876'));

  // En post per person med en lista bolag.
  const b = normalizeRoaringPersonEngagements(
    {
      records: [
        {
          person: { firstName: 'Anna' },
          beneficialOwnerships: [
            { legalEntity: { companyId: '556703-6271', companyName: 'Ewell AB' }, extentOfControl: { from: 50, to: 75 } },
            { companyId: '5594427808', companyName: 'Konsult AB', extentOfControl: '25-50' },
            { companyId: '5594427808', companyName: 'Konsult AB', extentOfControl: '25-50' }
          ]
        }
      ]
    },
    '198112189876',
    []
  );
  assert.deepEqual(
    b.map((x) => [x.org_nr, x.pct_min, x.pct_max]),
    [
      ['5567036271', 50, 75],
      ['5594427808', 25, 50]
    ]
  );
});

test('OpenAPI 2.1: huvudmannens namn (firstNames-lista) + personnummer, och personuppslaget med association', () => {
  const persons = roaringBeneficialOwnerPersons({
    records: [
      {
        caseId: '1',
        legalEntity: { companyId: '5595728790', companyName: 'Combly AB' },
        beneficialOwners: [
          {
            person: { firstNames: ['Anna', 'Maria'], surName: 'Testsson', personalNumber: '198112189876', birthDate: '1981-12-18' },
            extentOfControl: { code: 'MORE_THAN_75', description: 'Mer än 75 procent' },
            controlTypes: [{ code: 'AGER', description: 'Äger aktier' }]
          },
          { person: { firstNames: ['Bo'], surName: 'Samordning', coordinationNumber: '811278-9873' }, extentOfControl: { description: 'Mer än 25 men inte mer än 50 procent' } }
        ],
        status: { code: '0', description: 'Registrerad' }
      }
    ],
    status: { code: 0, text: 'found' }
  });
  assert.equal(persons[0].name, 'Anna Maria Testsson');
  assert.equal(persons[0].personalNumber, '198112189876');
  assert.equal(persons[0].pct_min, 75);
  assert.equal(persons[1].name, 'Bo Samordning');
  assert.equal(persons[1].personalNumber, '8112789873');
  assert.ok(!JSON.stringify(persons).includes('1981-12-18'));

  const notes: string[] = [];
  const eng = normalizeRoaringPersonEngagements(
    {
      records: [
        { association: { companyId: '5567036271', companyName: 'Ewell AB', type: { code: 'X', description: 'Aktiebolag' } }, person: { firstNames: ['Anna'], surName: 'Testsson' } },
        { association: { companyId: '5594427808', companyName: 'Wellgo Health AB' }, person: { firstNames: ['Anna'], surName: 'Testsson' } }
      ],
      status: { code: 0, text: 'found' }
    },
    '198112189876',
    notes
  );
  assert.deepEqual(
    eng.map((e) => [e.org_nr, e.name, e.pct_min]),
    [
      ['5567036271', 'Ewell AB', undefined],
      ['5594427808', 'Wellgo Health AB', undefined]
    ]
  );
});
