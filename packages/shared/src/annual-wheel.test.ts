import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNUAL_WHEEL_CATEGORY_IDS,
  ANNUAL_WHEEL_TRACK_IDS,
  annulusSectorPath,
  buildAnnualWheelTable,
  clampYear,
  filterAnnualWheelItems,
  groupItemsByMonth,
  isAnnualWheelCategory,
  isAnnualWheelTrack,
  monthShortLabel,
  monthSliceAngles,
  polarPoint,
  quarterForMonth,
  quarterSliceAngles,
  sanitizeMonth,
  type AnnualWheelItem
} from './annual-wheel.ts';

function item(partial: Partial<AnnualWheelItem>): AnnualWheelItem {
  return {
    id: Math.random().toString(36).slice(2),
    tenant: 't1',
    year: 2026,
    title: 'Aktivitet',
    month: 1,
    track: 'projekt',
    category: 'ledning',
    ...partial
  };
}

// ── Taxonomi-guards ──────────────────────────────────────────────────────────

test('category/track guards accept valid ids, reject junk', () => {
  assert.ok(isAnnualWheelCategory('styrelse'));
  assert.ok(isAnnualWheelCategory('ledning'));
  assert.equal(isAnnualWheelCategory('vd'), false);
  assert.equal(isAnnualWheelCategory(7), false);

  assert.ok(isAnnualWheelTrack('kampanjer'));
  assert.equal(isAnnualWheelTrack('saknas'), false);

  // Listorna är icke-tomma och unika.
  assert.equal(new Set(ANNUAL_WHEEL_CATEGORY_IDS).size, ANNUAL_WHEEL_CATEGORY_IDS.length);
  assert.equal(new Set(ANNUAL_WHEEL_TRACK_IDS).size, ANNUAL_WHEEL_TRACK_IDS.length);
});

// ── Månad / kvartal ──────────────────────────────────────────────────────────

test('sanitizeMonth clamps and coerces', () => {
  assert.equal(sanitizeMonth(1), 1);
  assert.equal(sanitizeMonth(12), 12);
  assert.equal(sanitizeMonth('6'), 6);
  assert.equal(sanitizeMonth(6.9), 6);
  assert.equal(sanitizeMonth(0), null);
  assert.equal(sanitizeMonth(13), null);
  assert.equal(sanitizeMonth(''), null);
  assert.equal(sanitizeMonth(null), null);
  assert.equal(sanitizeMonth('abc'), null);
});

test('monthShortLabel + quarterForMonth', () => {
  assert.equal(monthShortLabel(1), 'Jan');
  assert.equal(monthShortLabel(12), 'Dec');
  assert.equal(monthShortLabel(0), '');
  assert.equal(quarterForMonth(1), 1);
  assert.equal(quarterForMonth(3), 1);
  assert.equal(quarterForMonth(4), 2);
  assert.equal(quarterForMonth(12), 4);
  assert.equal(quarterForMonth(null), 0);
});

test('clampYear falls back outside range', () => {
  assert.equal(clampYear(2026, 2000), 2026);
  assert.equal(clampYear('2030', 2000), 2030);
  assert.equal(clampYear(1999, 2026), 2026);
  assert.equal(clampYear('nope', 2026), 2026);
});

// ── Filtrering ───────────────────────────────────────────────────────────────

test('filterAnnualWheelItems combines year/category/track', () => {
  const items = [
    item({ year: 2026, category: 'styrelse', track: 'projekt' }),
    item({ year: 2026, category: 'ledning', track: 'team' }),
    item({ year: 2025, category: 'styrelse', track: 'projekt' })
  ];
  assert.equal(filterAnnualWheelItems(items, { year: 2026 }).length, 2);
  assert.equal(filterAnnualWheelItems(items, { category: 'styrelse' }).length, 2);
  assert.equal(
    filterAnnualWheelItems(items, { year: 2026, category: 'styrelse' }).length,
    1
  );
  assert.equal(filterAnnualWheelItems(items, { track: 'team' }).length, 1);
  // 'all' = ingen begränsning.
  assert.equal(filterAnnualWheelItems(items, { category: 'all', track: 'all' }).length, 3);
});

// ── Gruppering / tabell ──────────────────────────────────────────────────────

test('groupItemsByMonth buckets null month at index 0 and sorts by track', () => {
  const items = [
    item({ month: null, title: 'Helår' }),
    item({ month: 3, track: 'team', title: 'B' }),
    item({ month: 3, track: 'kampanjer', title: 'A' })
  ];
  const buckets = groupItemsByMonth(items);
  assert.equal(buckets[0].length, 1);
  assert.equal(buckets[0][0].title, 'Helår');
  assert.equal(buckets[3].length, 2);
  // kampanjer (index 0) sorteras före team.
  assert.equal(buckets[3][0].track, 'kampanjer');
  assert.equal(buckets[3][1].track, 'team');
});

test('buildAnnualWheelTable yields 12 rows with one cell per track', () => {
  const items = [item({ month: 4, track: 'projekt', title: 'Bokslut' })];
  const rows = buildAnnualWheelTable(items);
  assert.equal(rows.length, 12);
  const april = rows[3];
  assert.equal(april.month, 4);
  assert.equal(april.monthLabel, 'Apr');
  assert.equal(april.quarter, 2);
  assert.equal(april.cells.length, ANNUAL_WHEEL_TRACK_IDS.length);
  const projektCell = april.cells.find((c) => c.track === 'projekt');
  assert.equal(projektCell?.items.length, 1);
  // Odaterade poster hamnar inte i tabellraderna.
  const withNull = buildAnnualWheelTable([item({ month: null })]);
  const totalInTable = withNull.reduce(
    (acc, r) => acc + r.cells.reduce((a, c) => a + c.items.length, 0),
    0
  );
  assert.equal(totalInTable, 0);
});

// ── Geometri ─────────────────────────────────────────────────────────────────

test('polarPoint places 0deg at top, 90deg at right', () => {
  const top = polarPoint(100, 100, 50, 0);
  assert.ok(Math.abs(top.x - 100) < 1e-6);
  assert.ok(Math.abs(top.y - 50) < 1e-6); // rakt upp
  const right = polarPoint(100, 100, 50, 90);
  assert.ok(Math.abs(right.x - 150) < 1e-6);
  assert.ok(Math.abs(right.y - 100) < 1e-6);
});

test('month + quarter slice angles partition the circle', () => {
  assert.deepEqual(monthSliceAngles(1), { start: 0, end: 30, mid: 15 });
  assert.deepEqual(monthSliceAngles(12), { start: 330, end: 360, mid: 345 });
  assert.deepEqual(quarterSliceAngles(1), { start: 0, end: 90, mid: 45 });
  assert.deepEqual(quarterSliceAngles(4), { start: 270, end: 360, mid: 315 });
  // Klampar utanför intervall.
  assert.equal(monthSliceAngles(99).end, 360);
});

test('annulusSectorPath produces a closed path with two arcs', () => {
  const path = annulusSectorPath(100, 100, 40, 80, 0, 30);
  assert.match(path, /^M /);
  assert.match(path, /A 80 80/);
  assert.match(path, /A 40 40/);
  assert.match(path, /Z$/);
});
