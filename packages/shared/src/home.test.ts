import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomeAgenda,
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
