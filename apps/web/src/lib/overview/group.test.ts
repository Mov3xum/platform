import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dueBucket,
  dueDateInputValue,
  formatDueLabel,
  groupByDue,
  isOverdue,
  openCount,
  overdueCount,
  recentlyDone,
  sortWorkItems
} from './group';
import type { WorkItem } from './status';

// 2026-09-29 10:00 svensk sommartid (UTC+2) = 08:00Z.
const NOW = new Date('2026-09-29T08:00:00.000Z');

function item(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    source: 'task',
    status: 'todo',
    title: over.id,
    kind: 'other',
    canEdit: true,
    ...over
  };
}

test('en uppgift som förfaller idag är INTE försenad mitt på dagen', () => {
  // PB lagrar datum utan klockslag som UTC-midnatt → 02:00 svensk tid samma dygn.
  const it = item({ id: 'a', dueAt: '2026-09-29 00:00:00.000Z' });
  assert.equal(isOverdue(it, NOW), false);
  assert.equal(dueBucket(it.dueAt, NOW), 'today');
  assert.equal(formatDueLabel(it.dueAt!, NOW), 'idag');
});

test('gårdagens datum är försenat, klara poster är det aldrig', () => {
  const late = item({ id: 'a', dueAt: '2026-09-28 00:00:00.000Z' });
  assert.equal(isOverdue(late, NOW), true);
  assert.equal(formatDueLabel(late.dueAt!, NOW), 'igår');
  assert.equal(isOverdue({ ...late, status: 'done' }, NOW), false);
});

test('midnattsgränsen räknas på svenskt dygn — 23:30Z är nästa dag i Stockholm', () => {
  // 2026-09-29 23:30Z = 30 sep 01:30 svensk tid → "imorgon", inte "idag".
  assert.equal(dueBucket('2026-09-29T23:30:00.000Z', NOW), 'week');
  assert.equal(formatDueLabel('2026-09-29T23:30:00.000Z', NOW), 'imorgon');
});

test('hinkar: idag, 1–7 dagar = denna vecka, därefter senare, saknas = utan datum', () => {
  assert.equal(dueBucket('2026-09-30', NOW), 'week');
  assert.equal(dueBucket('2026-10-06', NOW), 'week');
  assert.equal(dueBucket('2026-10-07', NOW), 'later');
  assert.equal(dueBucket(undefined, NOW), 'undated');
  assert.equal(dueBucket('inte ett datum', NOW), 'undated');
});

test('groupByDue utelämnar klara, tomma hinkar och sorterar tidigast först', () => {
  const groups = groupByDue(
    [
      item({ id: 'later', dueAt: '2026-11-01' }),
      item({ id: 'done', dueAt: '2026-09-01', status: 'done' }),
      item({ id: 'week2', dueAt: '2026-10-03' }),
      item({ id: 'week1', dueAt: '2026-10-01' }),
      item({ id: 'nodate' }),
      item({ id: 'over', dueAt: '2026-09-20' })
    ],
    NOW
  );
  assert.deepEqual(
    groups.map((g) => [g.id, g.items.map((i) => i.id)]),
    [
      ['overdue', ['over']],
      ['week', ['week1', 'week2']],
      ['later', ['later']],
      ['undated', ['nodate']]
    ]
  );
});

test('sortering: daterade före odaterade, sedan titel', () => {
  const sorted = sortWorkItems([
    item({ id: 'b', title: 'Beta' }),
    item({ id: 'a', title: 'Alfa' }),
    item({ id: 'd', title: 'Daterad', dueAt: '2026-10-01' })
  ]);
  assert.deepEqual(
    sorted.map((i) => i.id),
    ['d', 'a', 'b']
  );
});

test('räkningar: öppna exkluderar klara, försenade räknas bara bland öppna', () => {
  const items = [
    item({ id: 'a', dueAt: '2026-09-01' }),
    item({ id: 'b', dueAt: '2026-09-01', status: 'done' }),
    item({ id: 'c' })
  ];
  assert.equal(openCount(items), 2);
  assert.equal(overdueCount(items, NOW), 1);
  assert.deepEqual(
    recentlyDone(items).map((i) => i.id),
    ['b']
  );
});

test('dueDateInputValue ger svenskt kalenderdatum för date-inputen', () => {
  assert.equal(dueDateInputValue('2026-09-29 00:00:00.000Z'), '2026-09-29');
  assert.equal(dueDateInputValue('2026-09-29T23:30:00.000Z'), '2026-09-30');
  assert.equal(dueDateInputValue(undefined), '');
});
