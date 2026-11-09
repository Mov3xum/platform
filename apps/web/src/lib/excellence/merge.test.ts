import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupCompanyFacts } from '@platform/shared';
import { mergeGroupCompanyFacts, upsertGroupCompany } from './merge';

function company(over: Partial<GroupCompanyFacts> & { orgNr: string }): GroupCompanyFacts {
  return {
    dataFetched: true,
    ownership: [],
    groupStructureFetched: false,
    beneficialOwnersFetched: false,
    ...over
  };
}

test('mergeGroupCompanyFacts: bara hämtade delar ersätter — bokslut rör inte ägarbilden', () => {
  const existing = company({
    orgNr: '5594427808',
    name: 'Wellgo Health AB',
    basic: { registeredAt: '2020-01-01', bolagStatus: 'aktiv' },
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', name: 'Ewell', capital_pct: 90, part: 'group_structure' },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50, part: 'beneficial_owners' }
    ],
    groupStructureFetched: true,
    beneficialOwnersFetched: true,
    groupMembers: [{ org_nr: '5567036271', name: 'Ewell' }]
  });
  const fresh = company({ orgNr: '5594427808', financials: [{ year: 2025, employees: 3 }] });
  const merged = mergeGroupCompanyFacts(existing, fresh);
  assert.equal(merged.ownership.length, 2);
  assert.deepEqual(merged.financials, [{ year: 2025, employees: 3 }]);
  assert.equal(merged.basic?.registeredAt, '2020-01-01');
  assert.equal(merged.groupMembers?.length, 1);
});

test('mergeGroupCompanyFacts: verklig huvudman ersätter bara huvudmannens rader; namn följer med transient', () => {
  const existing = company({
    orgNr: '5594427808',
    ownership: [
      { direction: 'owner', owner_kind: 'company', org_nr: '5567036271', capital_pct: 90, part: 'group_structure' },
      { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50, part: 'beneficial_owners' }
    ],
    groupStructureFetched: true,
    beneficialOwnersFetched: true
  });
  const fresh = company({
    orgNr: '5594427808',
    ownership: [{ direction: 'owner', owner_kind: 'person', pct_min: 75, pct_max: 100, part: 'beneficial_owners', person_name: 'Anna Ägare' }],
    beneficialOwnersFetched: true
  });
  const merged = mergeGroupCompanyFacts(existing, fresh);
  assert.equal(merged.ownership.length, 2);
  assert.ok(merged.ownership.some((o) => o.part === 'group_structure' && o.capital_pct === 90));
  assert.ok(merged.ownership.some((o) => o.person_name === 'Anna Ägare' && o.pct_min === 75));
  assert.equal(merged.groupStructureFetched, true);
});

test('upsertGroupCompany: nytt org-nr läggs till, befintligt slås ihop', () => {
  const list = [company({ orgNr: '1' }), company({ orgNr: '2', name: 'Två' })];
  const added = upsertGroupCompany(list, company({ orgNr: '3' }));
  assert.equal(added.length, 3);
  const merged = upsertGroupCompany(list, company({ orgNr: '2', basic: { bolagStatus: 'aktiv' } }));
  assert.equal(merged.length, 2);
  assert.equal(merged[1].name, 'Två');
  assert.equal(merged[1].basic?.bolagStatus, 'aktiv');
});
