import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomeAgenda,
  buildHomeTimeline,
  homeDayLabel,
  mergeOmvarldItems,
  swedishDateLine,
  type HomeAgendaItem
} from './home';

function item(over: Partial<HomeAgendaItem> & { id: string; start: Date }): HomeAgendaItem {
  return {
    title: over.id,
    allDay: true,
    source: 'arshjul',
    href: '/arshjul',
    ...over
  };
}

test('swedishDateLine ger veckodag, dag, månad och ISO-vecka i svensk tid', () => {
  // 2026-09-09 är en onsdag, ISO-vecka 37. 23:30 UTC = 01:30 torsdag i Sverige.
  assert.equal(swedishDateLine(new Date('2026-09-09T10:00:00Z')), 'Onsdag 9 september · v. 37');
  assert.equal(swedishDateLine(new Date('2026-09-09T23:30:00Z')), 'Torsdag 10 september · v. 37');
});

test('homeDayLabel: idag, imorgon, veckodag, annars datum', () => {
  const today = new Date(2026, 8, 9); // onsdag
  assert.equal(homeDayLabel(new Date(2026, 8, 9), today), 'Idag');
  assert.equal(homeDayLabel(new Date(2026, 8, 8), today), 'Idag'); // pågående/passerad → idag
  assert.equal(homeDayLabel(new Date(2026, 8, 10), today), 'Imorgon');
  assert.equal(homeDayLabel(new Date(2026, 8, 11), today), 'Fredag');
  assert.equal(homeDayLabel(new Date(2026, 8, 20), today), '20 sep');
});

test('buildHomeAgenda: pågående under Idag, passerat bort, bortom horisonten bort, grupperat', () => {
  const today = new Date(2026, 8, 9);
  const groups = buildHomeAgenda(
    [
      item({ id: 'passerad', start: new Date(2026, 8, 1) }),
      item({ id: 'pågår', start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) }),
      item({ id: 'idag-b', start: new Date(2026, 8, 9) }),
      item({ id: 'idag-a', start: new Date(2026, 8, 9) }),
      item({ id: 'imorgon', start: new Date(2026, 8, 10), source: 'event', href: '/events/1' }),
      item({ id: 'långt-bort', start: new Date(2026, 9, 9) })
    ],
    today
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((i) => i.id)]),
    [
      ['Idag', ['idag-a', 'idag-b', 'pågår']],
      ['Imorgon', ['imorgon']]
    ]
  );
});

test('buildHomeAgenda respekterar taket', () => {
  const today = new Date(2026, 8, 9);
  const many = Array.from({ length: 20 }, (_, i) =>
    item({ id: `x${i}`, start: new Date(2026, 8, 9 + (i % 5)) })
  );
  const total = buildHomeAgenda(many, today, 14, 5).reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, 5);
});

test('mergeOmvarldItems: nyast först, dedupe på länk, max per källa', () => {
  const merged = mergeOmvarldItems(
    [
      {
        sourceKey: 'breakit',
        source: 'Breakit',
        items: [
          { title: 'B1', link: 'https://b/1', pubDate: '2026-09-09T08:00:00Z' },
          { title: 'B2', link: 'https://b/2', pubDate: '2026-09-08T08:00:00Z' },
          { title: 'B3', link: 'https://b/3', pubDate: '2026-09-07T08:00:00Z' },
          { title: 'B4', link: 'https://b/4', pubDate: '2026-09-06T08:00:00Z' },
          { title: 'dubblett', link: 'https://b/1', pubDate: '2026-09-09T09:00:00Z' }
        ]
      },
      {
        sourceKey: 'vinnova',
        source: 'Vinnova',
        items: [
          { title: 'V1', link: 'https://v/1', pubDate: '2026-09-09T07:00:00Z' },
          { title: 'utan datum', link: 'https://v/2' },
          { title: '', link: 'https://v/3' }
        ]
      }
    ],
    10,
    3
  );
  assert.deepEqual(
    merged.map((m) => m.title),
    ['B1', 'V1', 'B2', 'B3', 'utan datum']
  );
  assert.equal(merged[0]!.source, 'Breakit');
});

test('buildHomeTimeline: dagremsa, klippning mot fönstret och körfältspackning', () => {
  const today = new Date(2026, 8, 9); // onsdag
  const tl = buildHomeTimeline(
    [
      item({ id: 'passerad', start: new Date(2026, 8, 1), end: new Date(2026, 8, 5) }),
      item({ id: 'pågår', start: new Date(2026, 8, 7), end: new Date(2026, 8, 10) }),
      item({ id: 'idag', start: new Date(2026, 8, 9) }),
      item({ id: 'imorgon', start: new Date(2026, 8, 10) }),
      item({ id: 'lång', start: new Date(2026, 8, 20), end: new Date(2026, 9, 5) }),
      item({ id: 'bortom', start: new Date(2026, 9, 1) })
    ],
    today,
    14
  );
  assert.equal(tl.days.length, 14);
  assert.equal(tl.days[0].isToday, true);
  assert.equal(tl.days[0].weekday, 'on');
  assert.equal(tl.days[0].monthLabel, 'sep');
  assert.equal(tl.days[3].isWeekend, true); // lördag 12 sep
  // 1 oktober ligger på index 22 → utanför fönstret; ingen ny månadsetikett.
  assert.ok(tl.days.slice(1).every((d) => d.monthLabel === undefined));

  const ids = tl.spans.map((s) => s.item.id);
  assert.deepEqual(ids, ['pågår', 'idag', 'imorgon', 'lång']);
  const pagar = tl.spans[0];
  assert.equal(pagar.from, 0);
  assert.equal(pagar.to, 1);
  assert.equal(pagar.clippedStart, true);
  assert.equal(pagar.lane, 0);
  // "idag" krockar med det pågående bandet → nästa körfält.
  assert.equal(tl.spans[1].lane, 1);
  // "imorgon" (index 1): körfält 1 är ledigt men "idag" slutar vägg-i-vägg → nytt körfält
  // öppnas (max tre) så båda etiketterna får luft.
  assert.equal(tl.spans[2].lane, 2);
  // "lång" börjar dag 11, slutar bortom fönstret → klippt; hamnar i körfältet
  // vars föregående band slutade tidigast ("idag", körfält 1).
  const lang = tl.spans[3];
  assert.equal(lang.from, 11);
  assert.equal(lang.to, 13);
  assert.equal(lang.clippedEnd, true);
  assert.equal(lang.lane, 1);
  assert.equal(tl.lanes, 3);
  // Etiketten får flyta ut över lediga dagar fram till nästa band i körfältet.
  assert.equal(pagar.labelTo, 13); // körfält 0: inget mer band efter det pågående
  assert.equal(tl.spans[1].labelTo, 10); // "idag": fram till "lång" i körfält 1
  assert.equal(tl.spans[2].labelTo, 13); // "imorgon": ensam i körfält 2
  assert.equal(lang.labelTo, 13);
});

test('buildHomeTimeline: endagsposter i rad fördelas så etiketterna får luft', () => {
  const today = new Date(2026, 8, 9);
  const tl = buildHomeTimeline(
    [
      item({ id: 'a', start: new Date(2026, 8, 9) }),
      item({ id: 'b', start: new Date(2026, 8, 10) }),
      item({ id: 'c', start: new Date(2026, 8, 11) }),
      item({ id: 'd', start: new Date(2026, 8, 12) })
    ],
    today,
    14
  );
  assert.deepEqual(
    tl.spans.map((s) => [s.item.id, s.lane]),
    [
      ['a', 0],
      ['b', 1], // vägg-i-vägg med a → nytt körfält
      ['c', 0], // körfält 0 har mest luft (a slutade dag 0, ej granne) → återanvänds
      ['d', 1]
    ]
  );
  assert.equal(tl.lanes, 2);
  assert.equal(tl.spans[0].labelTo, 1); // a får dag 9–10 för sin etikett
});

test('buildHomeTimeline: tomt underlag ger bara dagremsan', () => {
  const tl = buildHomeTimeline([], new Date(2026, 8, 9), 7);
  assert.equal(tl.days.length, 7);
  assert.equal(tl.spans.length, 0);
  assert.equal(tl.lanes, 0);
});
