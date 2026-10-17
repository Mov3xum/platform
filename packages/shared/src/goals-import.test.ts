import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoalImportTemplateCsv,
  findGoalImportHeaderRow,
  parseGoalImportSheets,
  parseGoalLevelValue,
  parseGoalStatusValue,
  parseGoalTargetCell,
  parseGoalTeamCell,
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
  assert.equal(
    header,
    'Fokusområde;Måltyp;Nivå;Mål;Beskrivning;Överliggande mål;Team;Ansvarig;Indikator;Mätkälla;Metrik;Måltal;Enhet;Status Q1;Status Q2;Status Q3;Status Q4;Kommentar'
  );
  // Mallen går att importera igen.
  const rows = csv.replace('\uFEFF', '').trim().split('\r\n').map((r) => r.split(';'));
  const res = parseGoalImportRows(rows[0], rows.slice(1));
  assert.equal(res.goals.length, 4);
  assert.equal(res.goals[1].parent_title, '50 kvalificerade leads under året');
});

// ── Verksamhetsplanens Excel (Key Results 2026): ett blad per team, titelrad först ──

const DOC_HEADERS = [
  'Key result',
  'Beskrivning och definition av målet',
  'Övergripande mål - Objective',
  'Överliggande mål',
  'Ansvarigt team',
  'Ansvarig roll',
  'Key result nivå',
  'Målvärde 2026',
  'Status Q1',
  'Status Q2',
  'Status Q3',
  'Status Q4',
  'Kommentar om resultatet'
];

test('mapGoalImportHeaders: verksamhetsplanens rubriker', () => {
  assert.deepEqual(mapGoalImportHeaders(DOC_HEADERS), [
    'title',
    'description',
    'focus_area',
    'parent',
    'owner_team',
    'responsible',
    'level',
    'target',
    'status_q1',
    'status_q2',
    'status_q3',
    'status_q4',
    'status_comment'
  ]);
  assert.equal(findGoalImportHeaderRow([['Teamnivå - Coacher'], DOC_HEADERS]), 1);
  assert.equal(findGoalImportHeaderRow([['Bara en titel'], ['och text']]), -1);
});

test('värdetolkning: nivå, status, team och målvärde', () => {
  assert.equal(parseGoalLevelValue('Organisationsnivå'), 'organisation');
  assert.equal(parseGoalLevelValue('Teamnivå'), 'team');
  assert.equal(parseGoalLevelValue('Projektnivå'), 'project');
  assert.equal(parseGoalLevelValue('Projektindikatorer'), 'project_indicator');
  assert.equal(parseGoalLevelValue('Personligt mål'), 'personal');
  assert.equal(parseGoalStatusValue('I fas'), 'on_track');
  assert.equal(parseGoalStatusValue('Försenad'), 'delayed');
  assert.equal(parseGoalStatusValue('Ej startad'), 'not_started');
  assert.equal(parseGoalStatusValue('Klar'), 'done');
  assert.equal(parseGoalStatusValue('Risk'), 'risk');
  assert.equal(parseGoalStatusValue('kanske'), null);
  assert.deepEqual(parseGoalTeamCell('Coacher'), { team: 'coach', subteam: null });
  assert.deepEqual(parseGoalTeamCell('Ledningsgrupp'), { team: 'ledning', subteam: null });
  assert.deepEqual(parseGoalTeamCell('Sprint-X 2 - Kapital'), { team: 'projekt', subteam: 'Sprint-X 2 - Kapital' });
  assert.deepEqual(parseGoalTargetCell('Ja'), { target: null, unit: 'bool', text: null });
  assert.deepEqual(parseGoalTargetCell('25'), { target: 25, unit: 'count', text: null });
  assert.deepEqual(parseGoalTargetCell('75%'), { target: 75, unit: 'pct', text: null });
  assert.deepEqual(parseGoalTargetCell('50 st'), { target: 50, unit: 'count', text: null });
  assert.deepEqual(parseGoalTargetCell('Över 40%'), { target: 40, unit: 'pct', text: 'Över 40%' });
  assert.deepEqual(parseGoalTargetCell('TBD'), { target: null, unit: 'count', text: 'TBD' });
  assert.deepEqual(parseGoalTargetCell('4 (på skalan 1-5)'), { target: null, unit: 'count', text: '4 (på skalan 1-5)' }, 'flera tal ⇒ vi gissar inte måltalet');
  assert.equal(parseGoalTargetCell('Ökning med 12 st i BC och 5 st ink/acc Tot 17').target, null);
  assert.equal(parseGoalFocusAreaValue('Stärka varumärke & inflöde'), 'inflode_varumarke');
  assert.equal(parseGoalFocusAreaValue('Utveckla tematisk accelerator med spets'), 'tematisk_accelerator');
  assert.equal(parseGoalFocusAreaValue('Partner- och finansieringsstrategi'), 'partner_finansiering');
  assert.equal(parseGoalFocusAreaValue('Sprint-X 2.0'), null);
});

test('parseGoalImportSheets: alla blad, nivå, delteam, överliggande mål, status och kommentar', () => {
  const pad = (cells: string[]) => [...cells, ...Array(13 - cells.length).fill('')];
  const res = parseGoalImportSheets([
    {
      name: 'Teamnivå Coacher',
      rows: [
        ['Teamnivå - Coacher'],
        DOC_HEADERS,
        pad(['Antal bolag i våra program per år (ink/acc)', 'Antal bolag vi jobbar med', 'Kundvärde och kvalitetssäkring', '', 'Coacher', 'Lars Qvist', 'Organisationsnivå', '25']),
        pad(['Digitaliserad BoostChamber i drift', 'Ska genomföras enligt plan', 'Kundvärde och kvalitetssäkring', 'Antal bolag i våra program per år (ink/acc)', 'Coacher', 'Mitalee Kotak', 'Teamnivå', 'Ja', 'I fas', '', '', '', 'Identifiera KPIer'])
      ]
    },
    {
      name: 'Teamnivå Marknad',
      rows: [
        ['Teamnivå - Marknad'],
        DOC_HEADERS,
        pad(['Arrangera 3 aktiviteter i Söderhamn', '', 'Partner- och finansieringsstrategi', 'Etablerad samverkansplan', 'Marknad', 'Johan Mellström', 'Teamnivå', '3', 'Försenad', 'Försenad', 'Risk', '', 'Planerade: föreläsning i november'])
      ]
    },
    {
      name: 'SprintX',
      rows: [
        ['Sprint X'],
        DOC_HEADERS,
        pad(['Ökad exponering mot internationella marknader', '', 'Sprint-X 2.0', 'Antal företag som får stöd i projektet', 'Sprint-X 2 - Internationalisering', 'Hampus Granström', 'Projektnivå', '10 bolag gör en internationell insats', 'I fas', 'I fas', 'I fas']),
        pad(['Utökat investerarnätverk', '', 'Kundvärde och kvalitetssäkring', 'Antal Alumnibolag', 'Sprint-X 2 - Kapital', 'Albin Söderström', 'Personligt mål', '10', 'I fas', 'I fas'])
      ]
    },
    { name: 'EOI', rows: [['', '', 'EOI'], DOC_HEADERS, pad(['2 nya idétävlingar', '', 'Stärka varumärke & inflöde', '2 nya idétävlingar', 'EOI', 'Johan Mellström', 'Projektnivå', '2', 'I fas', 'Ej startad'])] },
    { name: 'Blad1', rows: [] }
  ]);
  assert.deepEqual(res.sheets, ['Teamnivå Coacher', 'Teamnivå Marknad', 'SprintX', 'EOI']);
  assert.equal(res.goals.length, 6);
  const [antal, boost, soderhamn, intl, invest, eoi] = res.goals;

  assert.equal(antal.level, 'organisation');
  assert.equal(antal.owner_team, 'coach');
  assert.equal(antal.responsible, 'Lars Qvist');
  assert.equal(antal.indicators[0].target, 25);
  assert.equal(antal.indicators[0].label, antal.title, 'utan indikatorkolumn får målet en indikator med samma namn');

  assert.equal(boost.parent_title, 'Antal bolag i våra program per år (ink/acc)');
  assert.equal(boost.indicators[0].unit, 'bool');
  assert.deepEqual(boost.indicators[0].statuses, [{ quarter: 1, status: 'on_track' }]);
  assert.equal(boost.indicators[0].comment, 'Identifiera KPIer');
  assert.equal(boost.line, 4, 'radnumret är bladets eget (titelrad + rubrikrad före)');
  assert.equal(boost.ref, 'Bladet "Teamnivå Coacher" rad 4');

  assert.equal(soderhamn.focus_area, 'partner_finansiering');
  assert.deepEqual(soderhamn.indicators[0].statuses, [
    { quarter: 1, status: 'delayed' },
    { quarter: 2, status: 'delayed' },
    { quarter: 3, status: 'risk' }
  ]);

  assert.equal(intl.focus_area, 'projekt', 'ett projekt som Objective blir Projektmål');
  assert.equal(intl.owner_team, 'projekt');
  assert.equal(intl.subteam, 'Sprint-X 2 - Internationalisering');
  assert.equal(intl.level, 'project');
  assert.equal(intl.indicators[0].target, 10);
  assert.equal(intl.indicators[0].target_text, '10 bolag gör en internationell insats');

  assert.equal(invest.kind, 'personal');
  assert.equal(invest.level, 'personal');
  assert.equal(invest.focus_area, 'kundvarde_kvalitet');
  assert.equal(invest.responsible, 'Albin Söderström');

  assert.equal(eoi.parent_title, null, 'ett mål pekar aldrig på sig självt');
  assert.equal(eoi.subteam, 'EOI');
  for (const w of res.warnings) assert.ok(!/Lars|Albin|Johan/.test(w), 'varningar innehåller aldrig cellvärden');
});
