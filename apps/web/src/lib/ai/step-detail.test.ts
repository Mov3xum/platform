import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeStepArgs,
  filterFields,
  formatStepDuration,
  groupTrailSteps,
  summarizeStepResult
} from './step-detail';

test('filterFields plockar fältnamn men aldrig värden', () => {
  assert.deepEqual(
    filterFields('date >= "2020-01-01" && date <= "2024-12-31" && startup.name ~ "Anna Svensson"'),
    ['date', 'startup.name']
  );
  assert.deepEqual(filterFields('investor ?= "abc" || amount_sek > 100000'), ['investor', 'amount_sek']);
  // Ett värde som ser ut som `fält = x` inuti en strängliteral får inte läcka.
  assert.deepEqual(filterFields('note ~ "email = anna@example.se"'), ['note']);
  assert.deepEqual(filterFields(''), []);
  assert.deepEqual(filterFields(undefined), []);
});

test('describeStepArgs: aggregat med gruppering och filterfält, utan värden', () => {
  const detail = describeStepArgs('aggregate_collection', {
    collection: 'capital_rounds',
    op: 'sum',
    field: 'amount_sek',
    group_by: 'startup',
    filter: 'date >= "2020-01-01" && date <= "2024-12-31"'
  });
  assert.equal(detail, 'summa av amount_sek per startup · filter på date');
  assert.equal(describeStepArgs('aggregate_collection', { op: 'count' }), 'antal');
});

test('describeStepArgs: query visar filter, sortering och gräns', () => {
  assert.equal(
    describeStepArgs('query_collection', { filter: 'phase = "incubation"', sort: '-created,name', limit: 50 }),
    'filter på phase · sorterat på created ↓, name · max 50 rader'
  );
  assert.equal(describeStepArgs('query_collection', {}), undefined);
});

test('describeStepArgs läcker aldrig sökfråga eller fri text i fältnamn', () => {
  const search = describeStepArgs('search_records', { collection: 'startups', query: 'Anna Svensson AB' });
  assert.ok(search && !search.includes('Anna'));
  const agg = describeStepArgs('aggregate_collection', { op: 'sum', field: 'Anna Svensson', group_by: 'x y' });
  assert.equal(agg, 'antal');
  const filter = describeStepArgs('count_collection', { filter: '"Anna" = name' });
  assert.ok(filter && !filter.includes('Anna'));
});

test('summarizeStepResult ger storlekar, aldrig värden', () => {
  assert.equal(
    summarizeStepResult('query_collection', { ok: true, data: { total: 37, returned: 20, items: [] } }),
    '37 träffar, hämtade 20'
  );
  assert.equal(summarizeStepResult('query_collection', { ok: true, data: { total: 1, returned: 1 } }), '1 rad');
  assert.equal(summarizeStepResult('count_collection', { ok: true, data: { count: 12 } }), '12 st');
  assert.equal(
    summarizeStepResult('aggregate_collection', {
      ok: true,
      data: { total: 7000, scanned: 5000, incomplete: true, value: 123456, groups: [{}, {}] }
    }),
    '2 grupper · 7000 rader · ofullständigt — räknade 5000'
  );
  assert.equal(
    summarizeStepResult('describe_collection', {
      ok: true,
      data: { fields: [{}, {}, {}], distinct_values: { values: ['a'] } }
    }),
    '3 fält · 1 distinkt värde'
  );
  assert.equal(summarizeStepResult('search_knowledge', { ok: true, data: { matched: 4 } }), '4 träffar');
  assert.equal(summarizeStepResult('query_collection', { ok: false, error: 'x' }), 'misslyckades');
  assert.match(summarizeStepResult('count_collection', { ok: true, repeated: true }) ?? '', /samma anrop/);
});

test('groupTrailSteps slår ihop identiska färdiga steg i följd', () => {
  const step = { tool: 'aggregate_collection', label: 'Sammanställer kapitalrundorna', detail: 'antal', ok: true };
  const groups = groupTrailSteps([
    { ...step, ms: 100 },
    { ...step, ms: 200, result: '3 grupper' },
    { ...step, detail: 'summa av amount_sek', ms: 50 },
    { ...step, running: true },
    { ...step, running: true }
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].ms, 300);
  assert.equal(groups[0].result, '3 grupper');
  assert.equal(groups[1].count, 1);
});

test('groupTrailSteps slår aldrig ihop misslyckade steg', () => {
  const step = { tool: 't', label: 'l', ok: false };
  assert.equal(groupTrailSteps([step, step]).length, 2);
});

test('formatStepDuration', () => {
  assert.equal(formatStepDuration(320), '320 ms');
  assert.equal(formatStepDuration(1450), '1,4 s');
  assert.equal(formatStepDuration(undefined), undefined);
});
