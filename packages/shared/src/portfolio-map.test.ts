import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortfolioMap,
  formatMonthsSv,
  isOnPortfolioMap,
  layoutPortfolioMap,
  monthsBetween,
  portfolioDateKey
} from './portfolio-map.ts';

const TODAY = '2026-11-26';

test('bara bolag i ett program visas — aldrig alumner, pausade eller avböjda', () => {
  assert.equal(isOnPortfolioMap('lead', 'active'), true);
  assert.equal(isOnPortfolioMap('inflode', ''), true);
  assert.equal(isOnPortfolioMap('incubation', 'active'), true);
  assert.equal(isOnPortfolioMap('acceleration', undefined), true);
  assert.equal(isOnPortfolioMap('alumni', 'active'), false);
  assert.equal(isOnPortfolioMap('paus', 'active'), false);
  assert.equal(isOnPortfolioMap('incubation', 'alumni'), false);
  assert.equal(isOnPortfolioMap('incubation', 'rejected'), false);
  assert.equal(isOnPortfolioMap('incubation', 'paused'), false);
  assert.equal(isOnPortfolioMap('okänd', 'active'), false);
});

test('datum tolkas ur PocketBase-format och månader räknas utan negativa värden', () => {
  assert.equal(portfolioDateKey('2025-03-14 00:00:00.000Z'), '2025-03-14');
  assert.equal(portfolioDateKey('2025-03-14T10:00:00Z'), '2025-03-14');
  assert.equal(portfolioDateKey(''), null);
  assert.equal(portfolioDateKey('2025-13-01'), null);
  assert.equal(monthsBetween('2025-11-26', TODAY), 12);
  assert.equal(monthsBetween('2026-11-26', TODAY), 0);
  assert.equal(monthsBetween('2027-01-01', TODAY), 0);
});

test('IRL tas ur KTH-bedömningen, annars bolagskortets reservvärde — 0 är aldrig en nivå', () => {
  const map = buildPortfolioMap({
    startups: [
      { id: 'a', name: 'A', phase: 'incubation', status: 'active', irl_level: 2 },
      { id: 'b', name: 'B', phase: 'incubation', status: 'active', irl_level: 3 },
      { id: 'c', name: 'C', phase: 'incubation', status: 'active', irl_level: 0 },
      { id: 'd', name: 'D', phase: 'alumni', status: 'alumni', irl_level: 8 }
    ],
    irlByStartup: new Map([['a', 4.25]]),
    phaseEntries: [],
    today: TODAY
  });
  assert.equal(map.total, 3);
  assert.equal(map.missingIrl, 1);
  const a = map.points.find((p) => p.id === 'a');
  const b = map.points.find((p) => p.id === 'b');
  assert.equal(a?.irl, 4.3);
  assert.equal(a?.irlSource, 'kth');
  assert.equal(b?.irl, 3);
  assert.equal(b?.irlSource, 'reserve');
  assert.equal(map.points.some((p) => p.id === 'c' || p.id === 'd'), false);
});

test('inskrivningen är senaste raden för NUVARANDE fas, sedan intagsdatum, sist systemdatum', () => {
  const map = buildPortfolioMap({
    startups: [
      { id: 'a', name: 'A', phase: 'incubation', irl_level: 4, intagsdatum: '2024-01-01' },
      { id: 'b', name: 'B', phase: 'lead', irl_level: 2, intagsdatum: '2026-05-26' },
      { id: 'c', name: 'C', phase: 'lead', irl_level: 2, created: '2026-08-26 10:00:00.000Z' },
      { id: 'd', name: 'D', phase: 'lead', irl_level: 2 }
    ],
    irlByStartup: new Map(),
    phaseEntries: [
      { startup: 'a', phase: 'boost_chamber', entered_at: '2024-02-01 00:00:00.000Z' },
      { startup: 'a', phase: 'incubation', entered_at: '2025-01-10 00:00:00.000Z' },
      { startup: 'a', phase: 'incubation', entered_at: '2025-11-26 00:00:00.000Z' }
    ],
    today: TODAY
  });
  const byId = new Map(map.points.map((p) => [p.id, p]));
  assert.equal(byId.get('a')?.sinceSource, 'phase');
  assert.equal(byId.get('a')?.since, '2025-11-26');
  assert.equal(byId.get('a')?.months, 12);
  assert.equal(byId.get('b')?.sinceSource, 'intake');
  assert.equal(byId.get('b')?.months, 6);
  assert.equal(byId.get('c')?.sinceSource, 'created');
  assert.equal(byId.get('d')?.months, null);
  assert.equal(map.missingSince, 1);
  assert.equal(map.approxSince, 1);
});

test('banden följer programmens ordning; Inflöde ritas bara när det har bolag', () => {
  const base = { irlByStartup: new Map<string, number>(), phaseEntries: [], today: TODAY };
  const without = buildPortfolioMap({ ...base, startups: [{ id: 'a', phase: 'prescale', irl_level: 5 }] });
  assert.deepEqual(
    without.bands.map((b) => b.phase),
    ['lead', 'boost_chamber', 'incubation', 'prescale', 'acceleration']
  );
  assert.equal(without.points[0].band, 3);
  const withInflow = buildPortfolioMap({
    ...base,
    startups: [
      { id: 'a', phase: 'prescale', irl_level: 5 },
      { id: 'b', phase: 'inflode', irl_level: 1 }
    ]
  });
  assert.equal(withInflow.bands[0].phase, 'inflode');
  assert.equal(withInflow.points.find((p) => p.id === 'a')?.band, 4);
});

test('tidsaxeln är minst 12 och högst 48 månader, i steg om 6', () => {
  const base = { irlByStartup: new Map<string, number>(), phaseEntries: [], today: TODAY };
  const short = buildPortfolioMap({ ...base, startups: [{ id: 'a', phase: 'lead', irl_level: 2, intagsdatum: '2026-09-26' }] });
  assert.equal(short.maxMonths, 12);
  const mid = buildPortfolioMap({ ...base, startups: [{ id: 'a', phase: 'lead', irl_level: 2, intagsdatum: '2025-06-26' }] });
  assert.equal(mid.maxMonths, 18);
  const long = buildPortfolioMap({ ...base, startups: [{ id: 'a', phase: 'lead', irl_level: 2, intagsdatum: '2018-01-01' }] });
  assert.equal(long.maxMonths, 48);
});

test('mina bolag = den inloggade är coach eller ägare; median räknas per band', () => {
  const map = buildPortfolioMap({
    startups: [
      { id: 'a', phase: 'incubation', irl_level: 3, coaches: ['u1', 'u2'] },
      { id: 'b', phase: 'incubation', irl_level: 5, owner: 'u1' },
      { id: 'c', phase: 'incubation', irl_level: 6, coaches: ['u2'] }
    ],
    irlByStartup: new Map(),
    phaseEntries: [],
    today: TODAY,
    userId: 'u1'
  });
  assert.deepEqual(
    map.points.filter((p) => p.mine).map((p) => p.id).sort(),
    ['a', 'b']
  );
  assert.equal(map.hasMine, true);
  const band = map.bands.find((b) => b.phase === 'incubation');
  assert.equal(band?.count, 3);
  assert.equal(band?.medianIrl, 5);
});

test('layouten håller punkterna inom sitt band och lägger aldrig två ovanpå varandra', () => {
  const startups = Array.from({ length: 12 }, (_, i) => ({
    id: `s${String(i).padStart(2, '0')}`,
    phase: 'incubation',
    irl_level: 4,
    intagsdatum: '2026-05-26'
  }));
  const data = buildPortfolioMap({ startups, irlByStartup: new Map(), phaseEntries: [], today: TODAY });
  const opts = { width: 900, height: 300, left: 30, right: 8, top: 12, bottom: 46, bandPad: 16, radius: 5.5 };
  const layout = layoutPortfolioMap(data, opts);
  const band = layout.bands.find((b) => b.phase === 'incubation')!;
  assert.equal(layout.dots.length, 12);
  for (const d of layout.dots) {
    assert.ok(d.x >= band.x0 && d.x <= band.x1, 'punkten ligger i sitt band');
    assert.ok(d.y >= layout.plotTop && d.y <= layout.plotBottom, 'punkten ligger på ritytan');
  }
  for (let i = 0; i < layout.dots.length; i++) {
    for (let j = i + 1; j < layout.dots.length; j++) {
      const dist = Math.hypot(layout.dots[i].x - layout.dots[j].x, layout.dots[i].y - layout.dots[j].y);
      assert.ok(dist >= opts.radius * 2, `punkt ${i} och ${j} överlappar (${dist.toFixed(1)} px)`);
    }
  }
  // Högre IRL ligger högre upp; längre tid ligger längre till höger.
  const two = buildPortfolioMap({
    startups: [
      { id: 'a', phase: 'lead', irl_level: 2, intagsdatum: '2026-10-26' },
      { id: 'b', phase: 'lead', irl_level: 7, intagsdatum: '2026-01-26' }
    ],
    irlByStartup: new Map(),
    phaseEntries: [],
    today: TODAY
  });
  const l2 = layoutPortfolioMap(two, opts);
  const a = l2.dots.find((d) => d.id === 'a')!;
  const b = l2.dots.find((d) => d.id === 'b')!;
  assert.ok(b.y < a.y);
  assert.ok(b.x > a.x);
});

test('tid skrivs ut på svenska', () => {
  assert.equal(formatMonthsSv(null), 'okänd tid');
  assert.equal(formatMonthsSv(0.4), 'under 1 mån');
  assert.equal(formatMonthsSv(8.2), '8 mån');
  assert.equal(formatMonthsSv(12), '1 år');
  assert.equal(formatMonthsSv(26.9), '2 år 2 mån');
});
