import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoaringBeneficialOwners,
  normalizeRoaringCompany,
  normalizeRoaringFinancials,
  normalizeRoaringGroupStructure,
  normalizeRoaringOverview
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
                { companyId: '5590000001', companyName: 'Dotter AB', ownedPercentage: 51 }
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
  assert.equal(holdings[0].org_nr, '5590000001');
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
  assert.equal(rows[0].control_basis, 'Äger aktier');
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
