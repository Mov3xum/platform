import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNUAL_WHEEL_CATEGORY_IDS,
  ANNUAL_WHEEL_TAG_IDS,
  ANNUAL_WHEEL_CATEGORY_KEY_MAX,
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelColorVar,
  annualWheelDateLabel,
  annualWheelShortDateLabel,
  annulusSectorPath,
  buildAnnualWheelTable,
  clampYear,
  countItemsByTag,
  dateAngleInYear,
  daysInMonth,
  DEFAULT_ANNUAL_WHEEL_CATEGORY_IDS,
  DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN,
  nextUpcomingItem,
  filterAnnualWheelItems,
  groupItemsByMonth,
  isAnnualWheelCategory,
  isAnnualWheelTag,
  isAnnualWheelCategoryKey,
  isAnnualWheelColorToken,
  monthShortLabel,
  monthSliceAngles,
  polarPoint,
  quarterForMonth,
  quarterSliceAngles,
  resolveAnnualWheelCategories,
  roundedAnnulusSectorPath,
  sanitizeAnnualWheelTags,
  slugifyAnnualWheelCategoryKey,
  sortAnnualWheelCategories,
  sanitizeDay,
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
    tags: ['projekt'],
    category: 'ledning',
    ...partial
  };
}

// ── Taxonomi-guards ──────────────────────────────────────────────────────────

test('category/tag guards accept valid ids, reject junk', () => {
  assert.ok(isAnnualWheelCategory('styrelse'));
  assert.ok(isAnnualWheelCategory('ledning'));
  assert.equal(isAnnualWheelCategory('vd'), false);
  assert.equal(isAnnualWheelCategory(7), false);

  assert.ok(isAnnualWheelTag('kampanjer'));
  assert.equal(isAnnualWheelTag('saknas'), false);

  // Listorna är icke-tomma och unika.
  assert.equal(new Set(ANNUAL_WHEEL_CATEGORY_IDS).size, ANNUAL_WHEEL_CATEGORY_IDS.length);
  assert.equal(new Set(ANNUAL_WHEEL_TAG_IDS).size, ANNUAL_WHEEL_TAG_IDS.length);
});

// ── Taggar (valfria, flera) ──────────────────────────────────────────────────

test('sanitizeAnnualWheelTags accepts arrays, single values and legacy csv', () => {
  assert.deepEqual(sanitizeAnnualWheelTags(['projekt', 'team']), ['projekt', 'team']);
  // Enkelvärde (gammalt `track`) → lista.
  assert.deepEqual(sanitizeAnnualWheelTags('kampanjer'), ['kampanjer']);
  assert.deepEqual(sanitizeAnnualWheelTags('projekt,team'), ['projekt', 'team']);
  // Dubbletter och skräp rensas; taxonomins ordning bevaras.
  assert.deepEqual(sanitizeAnnualWheelTags(['team', 'projekt', 'team', 'nonsens']), [
    'projekt',
    'team'
  ]);
  // Tomt = otaggad (taggar är valfria).
  assert.deepEqual(sanitizeAnnualWheelTags(null), []);
  assert.deepEqual(sanitizeAnnualWheelTags(''), []);
  assert.deepEqual(sanitizeAnnualWheelTags([]), []);
  assert.deepEqual(sanitizeAnnualWheelTags(7), []);
});

test('countItemsByTag counts multi-tagged items once per tag and reports untagged', () => {
  const items = [
    item({ tags: ['projekt', 'team'] }),
    item({ tags: ['projekt'] }),
    item({ tags: [] })
  ];
  const counts = countItemsByTag(items);
  assert.equal(counts.find((c) => c.tag === 'projekt')?.count, 2);
  assert.equal(counts.find((c) => c.tag === 'team')?.count, 1);
  assert.equal(counts.find((c) => c.tag === null)?.count, 1);
  // Taggar utan poster utelämnas.
  assert.equal(counts.some((c) => c.tag === 'kampanjer'), false);
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

test('filterAnnualWheelItems combines year/category/tag/responsible', () => {
  const items = [
    item({ year: 2026, category: 'styrelse', tags: ['projekt', 'team'], responsible: 'u1' }),
    item({ year: 2026, category: 'ledning', tags: ['team'] }),
    item({ year: 2025, category: 'styrelse', tags: ['projekt'], responsible: 'u2' })
  ];
  assert.equal(filterAnnualWheelItems(items, { year: 2026 }).length, 2);
  assert.equal(filterAnnualWheelItems(items, { category: 'styrelse' }).length, 2);
  assert.equal(
    filterAnnualWheelItems(items, { year: 2026, category: 'styrelse' }).length,
    1
  );
  // Tagg-filtret matchar poster som bär taggen (flera taggar tillåtna).
  assert.equal(filterAnnualWheelItems(items, { tag: 'team' }).length, 2);
  assert.equal(filterAnnualWheelItems(items, { tag: 'projekt' }).length, 2);
  // Ansvarig.
  assert.equal(filterAnnualWheelItems(items, { responsible: 'u1' }).length, 1);
  assert.equal(filterAnnualWheelItems(items, { responsible: 'none' }).length, 1);
  // Otaggade poster.
  assert.equal(filterAnnualWheelItems([...items, item({ tags: [] })], { tag: 'none' }).length, 1);
  // 'all' = ingen begränsning.
  assert.equal(
    filterAnnualWheelItems(items, { category: 'all', tag: 'all', responsible: 'all' }).length,
    3
  );
});

// ── Gruppering / tabell ──────────────────────────────────────────────────────

test('groupItemsByMonth buckets null month at index 0 and sorts by first tag', () => {
  const items = [
    item({ month: null, title: 'Helår' }),
    item({ month: 3, tags: ['team'], title: 'B' }),
    item({ month: 3, tags: ['kampanjer'], title: 'A' }),
    item({ month: 3, tags: [], title: 'C' })
  ];
  const buckets = groupItemsByMonth(items);
  assert.equal(buckets[0].length, 1);
  assert.equal(buckets[0][0].title, 'Helår');
  assert.equal(buckets[3].length, 3);
  // kampanjer (index 0) sorteras före team; otaggade sist.
  assert.deepEqual(buckets[3][0].tags, ['kampanjer']);
  assert.deepEqual(buckets[3][1].tags, ['team']);
  assert.deepEqual(buckets[3][2].tags, []);
});

test('buildAnnualWheelTable yields 12 rows with one cell per tag + untagged', () => {
  const items = [
    item({ month: 4, tags: ['projekt', 'team'], title: 'Bokslut' }),
    item({ month: 4, tags: [], title: 'Otaggat' })
  ];
  const rows = buildAnnualWheelTable(items);
  assert.equal(rows.length, 12);
  const april = rows[3];
  assert.equal(april.month, 4);
  assert.equal(april.monthLabel, 'Apr');
  assert.equal(april.quarter, 2);
  // En kolumn per tagg + en kolumn för otaggade.
  assert.equal(april.cells.length, ANNUAL_WHEEL_TAG_IDS.length + 1);
  // En post med flera taggar syns i varje matchande kolumn.
  assert.equal(april.cells.find((c) => c.tag === 'projekt')?.items.length, 1);
  assert.equal(april.cells.find((c) => c.tag === 'team')?.items.length, 1);
  const untagged = april.cells.find((c) => c.tag === null);
  assert.equal(untagged?.items.length, 1);
  assert.equal(untagged?.items[0].title, 'Otaggat');
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

test('roundedAnnulusSectorPath rounds corners with béziers and clamps radius', () => {
  const path = roundedAnnulusSectorPath(100, 100, 40, 80, 0, 30, 8);
  assert.match(path, /^M /);
  assert.match(path, /A 80 80/);
  assert.match(path, /A 40 40/);
  assert.match(path, /Q /); // rundade hörn
  assert.match(path, /Z$/);

  // Hörnradie 0 → faller tillbaka på den skarpa varianten (inga béziers).
  const sharp = roundedAnnulusSectorPath(100, 100, 40, 80, 0, 30, 0);
  assert.equal(sharp, annulusSectorPath(100, 100, 40, 80, 0, 30));

  // Smal sektor: orimligt stor radie ska klampas, inte krascha/producera NaN.
  const narrow = roundedAnnulusSectorPath(100, 100, 40, 80, 0, 2, 50);
  assert.doesNotMatch(narrow, /NaN/);
  assert.match(narrow, /Z$/);
});

// ── "Idag"-visare + nedräkning ───────────────────────────────────────────────

test('daysInMonth is leap-year aware', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('dateAngleInYear maps dates into equal-month sectors', () => {
  // 1 jan = toppen (0°).
  assert.equal(dateAngleInYear(new Date(2026, 0, 1), 2026), 0);
  // 1 feb = början på andra sektorn (30°).
  assert.equal(dateAngleInYear(new Date(2026, 1, 1), 2026), 30);
  // Mitten av en 31-dagarsmånad ligger inom sektorn (mellan 0 och 30).
  const mid = dateAngleInYear(new Date(2026, 0, 16), 2026)!;
  assert.ok(mid > 0 && mid < 30);
  // Annat år → ingen visare.
  assert.equal(dateAngleInYear(new Date(2025, 5, 1), 2026), null);
});

test('nextUpcomingItem picks the soonest dated item from a reference day', () => {
  const items: AnnualWheelItem[] = [
    item({ id: 'a', title: 'Bokslut', month: 1, year: 2026 }),
    item({ id: 'b', title: 'Strategidag', month: 8, year: 2026 }),
    item({ id: 'c', title: 'Helår', month: null, year: 2026 })
  ];
  const next = nextUpcomingItem(items, new Date(2026, 4, 10)); // 10 maj
  assert.equal(next?.item.id, 'b'); // aug är nästa framåt
  assert.ok(next!.days > 0);

  // Idag (1:a i månaden) → days = 0.
  const today = nextUpcomingItem(items, new Date(2026, 0, 1));
  assert.equal(today?.item.id, 'a');
  assert.equal(today?.days, 0);

  // Inga framtida poster → null.
  const none = nextUpcomingItem(items, new Date(2027, 0, 1));
  assert.equal(none, null);
});

// ── Specifikt datum (day) ────────────────────────────────────────────────────

test('sanitizeDay clamps and coerces 1–31', () => {
  assert.equal(sanitizeDay(1), 1);
  assert.equal(sanitizeDay(31), 31);
  assert.equal(sanitizeDay('12'), 12);
  assert.equal(sanitizeDay(12.7), 12);
  assert.equal(sanitizeDay(0), null);
  assert.equal(sanitizeDay(32), null);
  assert.equal(sanitizeDay(''), null);
  assert.equal(sanitizeDay(null), null);
  assert.equal(sanitizeDay('abc'), null);
});

test('annualWheelDateLabel renders day/month/year variants', () => {
  assert.equal(annualWheelDateLabel(8, 12, 2026), '12 augusti 2026');
  assert.equal(annualWheelDateLabel(8, null, 2026), 'augusti 2026');
  assert.equal(annualWheelDateLabel(null, null, 2026), 'Hela året 2026');
  // Dag utan giltig månad → behandlas som hela året.
  assert.equal(annualWheelDateLabel(null, 12, 2026), 'Hela året 2026');
});

test('annualWheelShortDateLabel renders compact list/chip labels', () => {
  assert.equal(annualWheelShortDateLabel(8, 12), '12 aug');
  assert.equal(annualWheelShortDateLabel(8, null), 'aug');
  assert.equal(annualWheelShortDateLabel(null, null), 'Hela året');
  // Dag utan giltig månad → hela året (samma tolkning som den långa etiketten).
  assert.equal(annualWheelShortDateLabel(null, 12), 'Hela året');
  // Tolerant mot strängar från formulär/DB.
  assert.equal(annualWheelShortDateLabel('3' as unknown as number, '9' as unknown as number), '9 mar');
});

test('nextUpcomingItem honours specific day within the month', () => {
  const items: AnnualWheelItem[] = [
    item({ id: 'a', month: 6, day: 1, year: 2026 }),
    item({ id: 'b', month: 6, day: 20, year: 2026 })
  ];
  // 10 juni: dag-1-posten har passerat, dag-20 är nästa.
  const next = nextUpcomingItem(items, new Date(2026, 5, 10));
  assert.equal(next?.item.id, 'b');
  assert.equal(next?.date.getDate(), 20);
});

// ── Dynamiska kategorier (per tenant) ────────────────────────────────────────

test('isAnnualWheelCategory checks membership in a dynamic list', () => {
  const dynamic = [
    { id: 'agarmoten', label: 'Ägarmöten', token: 'bla' as const },
    { id: 'ledning', label: 'Ledningsgrupp', token: 'gul' as const }
  ];
  assert.ok(isAnnualWheelCategory('agarmoten', dynamic));
  assert.equal(isAnnualWheelCategory('styrelse', dynamic), false);
  // Utan lista gäller defaults (bakåtkompatibelt).
  assert.ok(isAnnualWheelCategory('styrelse'));
});

test('slugifyAnnualWheelCategoryKey transliterates Swedish and rejects junk', () => {
  assert.equal(slugifyAnnualWheelCategoryKey('Ägarmöten'), 'agarmoten');
  assert.equal(slugifyAnnualWheelCategoryKey('Styrelse & ledning'), 'styrelse-ledning');
  assert.equal(slugifyAnnualWheelCategoryKey('  Hållbarhet  '), 'hallbarhet');
  assert.equal(slugifyAnnualWheelCategoryKey('ÅÄÖ'), 'aao');
  assert.equal(slugifyAnnualWheelCategoryKey('---'), null);
  assert.equal(slugifyAnnualWheelCategoryKey(''), null);
  assert.equal(slugifyAnnualWheelCategoryKey(42), null);
  // Cappas till nyckelns maxlängd och slutar aldrig på bindestreck.
  const long = slugifyAnnualWheelCategoryKey('a'.repeat(60));
  assert.equal(long?.length, ANNUAL_WHEEL_CATEGORY_KEY_MAX);
});

test('isAnnualWheelCategoryKey enforces the slug shape', () => {
  assert.ok(isAnnualWheelCategoryKey('styrelse'));
  assert.ok(isAnnualWheelCategoryKey('q1-mote_2'));
  assert.equal(isAnnualWheelCategoryKey('Styrelse'), false); // versaler
  assert.equal(isAnnualWheelCategoryKey('-styrelse'), false); // inledande bindestreck
  assert.equal(isAnnualWheelCategoryKey('sty relse'), false); // blanksteg
  assert.equal(isAnnualWheelCategoryKey('a'.repeat(41)), false);
  assert.equal(isAnnualWheelCategoryKey(''), false);
  assert.equal(isAnnualWheelCategoryKey(null), false);
});

test('annualWheelColorVar maps tokens and falls back for junk', () => {
  assert.equal(annualWheelColorVar('gron'), 'var(--movexum-gron)');
  assert.equal(annualWheelColorVar('bla'), 'var(--movexum-bla)');
  // Okänd/ogiltig token → default-tokenen (aldrig ad-hoc-hex, § 2.2).
  assert.equal(annualWheelColorVar('#ff0000'), `var(--movexum-${DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN})`);
  assert.equal(annualWheelColorVar(undefined), `var(--movexum-${DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN})`);
  assert.ok(isAnnualWheelColorToken(DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN));
});

test('resolveAnnualWheelCategories normalizes PB rows', () => {
  const resolved = resolveAnnualWheelCategories([
    { id: 'rec2', key: 'ledning', label: 'Ledning', token: 'gul', sort_order: 2 },
    { id: 'rec1', key: 'agarmoten', label: 'Ägarmöten', token: 'bla', sort_order: 1 },
    // Ogiltiga rader kastas: trasig nyckel, tom etikett, dubblett, icke-objekt.
    { id: 'rec3', key: 'Fel Nyckel', label: 'Fel', token: 'bla' },
    { id: 'rec4', key: 'tom', label: '   ', token: 'bla' },
    { id: 'rec5', key: 'ledning', label: 'Dubblett', token: 'gron' },
    null
  ]);
  assert.deepEqual(
    resolved.map((c) => [c.id, c.label, c.token, c.recordId]),
    [
      ['agarmoten', 'Ägarmöten', 'bla', 'rec1'],
      ['ledning', 'Ledning', 'gul', 'rec2']
    ]
  );
});

test('resolveAnnualWheelCategories defaults token and falls back when empty', () => {
  const [one] = resolveAnnualWheelCategories([{ id: 'r', key: 'nytt', label: 'Nytt', token: 'magenta' }]);
  assert.equal(one.token, DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN);

  // Tom/saknad kollektion → defaults, så hjulet aldrig blir legendlöst.
  for (const empty of [[], null, undefined]) {
    assert.deepEqual(
      resolveAnnualWheelCategories(empty).map((c) => c.id),
      [...DEFAULT_ANNUAL_WHEEL_CATEGORY_IDS]
    );
  }
});

test('label/color lookups tolerate a category that was removed', () => {
  const dynamic = [{ id: 'agarmoten', label: 'Ägarmöten', token: 'bla' as const }];
  assert.equal(annualWheelCategoryLabel('agarmoten', dynamic), 'Ägarmöten');
  // Post som pekar på en raderad kategori: rå nyckel + default-färg, ingen krasch.
  assert.equal(annualWheelCategoryLabel('borttagen', dynamic), 'borttagen');
  assert.equal(
    annualWheelCategoryColorVar('borttagen', dynamic),
    `var(--movexum-${DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN})`
  );
});

test('sortAnnualWheelCategories orders by sortOrder then label', () => {
  const sorted = sortAnnualWheelCategories([
    { id: 'c', label: 'Ceta', token: 'gul' },
    { id: 'a', label: 'Alfa', token: 'gron', sortOrder: 5 },
    { id: 'b', label: 'Beta', token: 'lila', sortOrder: 1 }
  ]);
  // Utan sortOrder hamnar posten sist (999).
  assert.deepEqual(sorted.map((c) => c.id), ['b', 'a', 'c']);
});
