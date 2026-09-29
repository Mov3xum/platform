import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoalImportTemplateCsv,
  mapGoalImportHeaders,
  parseGoalFocusAreaValue,
  parseGoalImportRows,
  parseGoalKindValue,
  parseGoalMetricValue,
  parseGoalSourceValue
} from './goals-import.ts';

test('mapGoalImportHeaders känner igen svenska/engelska rubriker', () => {
  assert.deepEqual(mapGoalImportHeaders(['Fokusområde', 'Måltyp', 'Mål', 'Team', 'Ägare (e-post)', 'Indikator', 'Mätkälla', 'Metrik', 'Måltal', 'Enhet', 'Okänd']), [
    'focus_area',
    'kind',
    'title',
    'owner_team',
    'owner_email',
    'indicator',
    'source',
    'metric_key',
    'target',
    'unit',
    null
  ]);
  assert.deepEqual(mapGoalImportHeaders(['focus_area', 'Goal', 'KPI', 'Target']), ['focus_area', 'title', 'indicator', 'target']);
});

test('värden matchas på nyckel och etikett', () => {
  assert.equal(parseGoalFocusAreaValue('Inflöde och varumärke'), 'inflode_varumarke');
  assert.equal(parseGoalFocusAreaValue('inflode_varumarke'), 'inflode_varumarke');
  assert.equal(parseGoalFocusAreaValue('Partner'), 'partner_finansiering');
  assert.equal(parseGoalFocusAreaValue('Nonsens'), null);
  assert.equal(parseGoalKindValue('Personligt mål'), 'personal');
  assert.equal(parseGoalKindValue('övergripande'), 'overall');
  assert.equal(parseGoalSourceValue('Beräknas ur data'), 'computed');
  assert.equal(parseGoalSourceValue('manuell'), 'manual');
  assert.equal(parseGoalMetricValue('Alumnibolag'), 'alumni_count');
  assert.equal(parseGoalMetricValue('alumni_count'), 'alumni_count');
  assert.equal(parseGoalMetricValue('Mina uppgifter'), null, 'personliga mått kan inte vara verksamhetsmål');
});

test('parseGoalImportRows: grupperar indikatorer per mål, ärver fokusområde, varnar PII-fritt', () => {
  const headers = ['Fokusområde', 'Måltyp', 'Mål', 'Team', 'Ägare', 'Indikator', 'Mätkälla', 'Metrik', 'Måltal', 'Enhet'];
  const rows = [
    ['Inflöde och varumärke', '', '50 leads', 'Marknad', '', 'Nya leads', 'Beräknas ur data', 'Nya leads', '50', ''],
    ['', '', '50 leads', 'Marknad', '', 'Kampanjer', 'Manuell', '', '4', 'Antal'],
    ['', '', '', '', '', 'Nyhetsbrev', '', '', '12', 'st'],
    ['Kundvärde', 'Personligt', 'Coachsamtal', 'Coach', 'Anna.Andersson@movexum.se', 'Samtal/kvartal', '', '', '12,5', ''],
    ['Kundvärde', 'Personligt', 'Utan ägare', 'Coach', '', '', '', '', '', ''],
    ['Nonsens', '', 'x', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['Kundvärde', '', '', '', '', '', '', '', '', '']
  ];
  const res = parseGoalImportRows(headers, rows);
  assert.equal(res.goals.length, 3);
  const [leads, coach, noOwner] = res.goals;
  assert.equal(leads.focus_area, 'inflode_varumarke');
  assert.equal(leads.kind, 'overall');
  assert.equal(leads.owner_team, 'marknad');
  assert.deepEqual(
    leads.indicators.map((i) => [i.label, i.source, i.metric_key, i.target, i.unit]),
    [
      ['Nya leads', 'computed', 'leads_in_period', 50, 'count'],
      ['Kampanjer', 'manual', null, 4, 'count'],
      ['Nyhetsbrev', 'manual', null, 12, 'count']
    ]
  );
  assert.equal(coach.kind, 'personal');
  assert.equal(coach.owner_email, 'anna.andersson@movexum.se');
  assert.equal(coach.indicators[0].target, 12.5);
  assert.equal(noOwner.kind, 'personal');
  assert.equal(noOwner.owner_email, null);
  assert.ok(res.warnings.some((w) => w.startsWith('Rad 6: personligt mål utan ägarens e-post')));
  assert.ok(res.warnings.some((w) => w.startsWith('Rad 7: okänt fokusområde')));
  assert.ok(res.warnings.some((w) => w.startsWith('Rad 9: saknar mål/titel')));
  for (const w of res.warnings) assert.ok(!w.includes('Anna'), 'varningar innehåller aldrig cellvärden');
});

test('parseGoalImportRows: beräknad utan metrik och enkät degraderas till manuell; saknad titelkolumn stoppar', () => {
  const res = parseGoalImportRows(
    ['Fokusområde', 'Mål', 'Indikator', 'Mätkälla', 'Metrik'],
    [
      ['Partner', 'Fler partners', 'Partners', 'computed', 'påhittad'],
      ['Partner', 'Fler partners', 'Nöjdhet', 'Enkät', '']
    ]
  );
  assert.equal(res.goals.length, 1);
  assert.deepEqual(res.goals[0].indicators.map((i) => i.source), ['manual', 'manual']);
  assert.equal(res.warnings.length, 2);
  const none = parseGoalImportRows(['Fokusområde', 'Beskrivning'], [['Partner', 'x']]);
  assert.equal(none.goals.length, 0);
  assert.match(none.warnings[0], /titel/);
});

test('buildGoalImportTemplateCsv har BOM, semikolon och alla rubriker', () => {
  const csv = buildGoalImportTemplateCsv();
  assert.ok(csv.startsWith('﻿'));
  const [header] = csv.replace('﻿', '').split('\r\n');
  assert.equal(header, 'Fokusområde;Måltyp;Mål;Beskrivning;Team;Ägare (e-post);Indikator;Mätkälla;Metrik;Måltal;Enhet');
});
