import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROGRAM_START,
  formatReadinessCell,
  dateOnly,
  inWindow,
  intersect,
  timeEntryValue,
  latestReadiness,
  buildLagesredovisningRows,
  buildLagesredovisning,
  validateRow,
  type LagesredovisningInput,
  type BuildOptions
} from './reporting.ts';

const PERIOD = { from: '2025-07-01', to: '2025-12-31' };
const OPTS: BuildOptions = { reportPeriod: PERIOD, fallbackRate: 641 };

function baseInput(over: Partial<LagesredovisningInput> = {}): LagesredovisningInput {
  return {
    startup: {
      id: 's1',
      name: 'Enava AB',
      org_nr: '559200-1969',
      status: 'active',
      vinnova_focus: 'miljo_energi',
      state_aid_start_at: '2023-08-28'
    },
    timeEntries: [],
    costs: [],
    readiness: [],
    stateAidPeriods: [],
    ...over
  };
}

// ── Datum-hjälpare ────────────────────────────────────────────────────────────

test('dateOnly trimmar tid och hanterar tomt', () => {
  assert.equal(dateOnly('2025-11-05 00:00:00'), '2025-11-05');
  assert.equal(dateOnly('2025-11-05'), '2025-11-05');
  assert.equal(dateOnly(''), null);
  assert.equal(dateOnly(undefined), null);
});

test('inWindow är inklusiv och hanterar öppet slut', () => {
  assert.equal(inWindow('2025-07-01', '2025-07-01', '2025-12-31'), true);
  assert.equal(inWindow('2025-12-31', '2025-07-01', '2025-12-31'), true);
  assert.equal(inWindow('2026-01-01', '2025-07-01', '2025-12-31'), false);
  assert.equal(inWindow('2030-01-01', '2025-07-01', null), true);
  assert.equal(inWindow(null, '2025-07-01', null), false);
});

test('intersect ger skärning eller null', () => {
  assert.deepEqual(
    intersect({ from: '2025-07-01', to: '2025-12-31' }, { from: '2025-09-01', to: '2026-03-01' }),
    { from: '2025-09-01', to: '2025-12-31' }
  );
  assert.equal(intersect({ from: '2025-01-01', to: '2025-02-01' }, { from: '2025-03-01', to: '2025-04-01' }), null);
});

// ── Värdeberäkning ────────────────────────────────────────────────────────────

test('timeEntryValue använder eget timpris före fallback', () => {
  assert.equal(timeEntryValue({ activity_kind: 'incubation', hours: 38, occurred_on: '2025-08-01' }, 641), 38 * 641);
  assert.equal(
    timeEntryValue({ activity_kind: 'incubation', hours: 10, hourly_rate_sek: 800, occurred_on: '2025-08-01' }, 641),
    8000
  );
});

test('inkubatortjänster = incubation-tid + external_service-kostnad; verifiering = verification-kostnad', () => {
  const input = baseInput({
    timeEntries: [
      { activity_kind: 'incubation', hours: 38, occurred_on: '2025-08-01' }, // 24358
      { activity_kind: 'admin', hours: 5, occurred_on: '2025-08-01' } // exkluderas
    ],
    costs: [
      { cost_type: 'verification', amount_sek: 88292.75, incurred_on: '2025-09-01' },
      { cost_type: 'external_service', amount_sek: 1000, incurred_on: '2025-09-01' },
      { cost_type: 'other', amount_sek: 9999, incurred_on: '2025-09-01' } // exkluderas
    ]
  });
  const [row] = buildLagesredovisningRows(input, OPTS);
  assert.equal(row.period.inkubator, 38 * 641 + 1000);
  assert.equal(row.period.verifiering, 88292.75);
  assert.equal(row.period.summa, 38 * 641 + 1000 + 88292.75);
});

test('poster utanför perioden räknas inte i period men i ackumulerat', () => {
  const input = baseInput({
    timeEntries: [
      { activity_kind: 'incubation', hours: 10, occurred_on: '2025-08-01' }, // i perioden
      { activity_kind: 'incubation', hours: 10, occurred_on: '2025-03-01' } // före perioden, men efter programstart? nej, före
    ]
  });
  // programstart = 2025-07-01, så marsposten ligger utanför även ackumulerat
  const [row] = buildLagesredovisningRows(input, OPTS);
  assert.equal(row.period.inkubator, 10 * 641);
  assert.equal(row.accumulated.inkubator, 10 * 641);
});

test('ackumulerat täcker programstart→periodslut', () => {
  const input = baseInput({
    timeEntries: [
      { activity_kind: 'incubation', hours: 10, occurred_on: '2025-08-01' }, // period + acc
      { activity_kind: 'incubation', hours: 5, occurred_on: '2025-07-15' } // period + acc (samma period här)
    ]
  });
  const opts: BuildOptions = { reportPeriod: { from: '2025-10-01', to: '2025-12-31' }, fallbackRate: 641 };
  const [row] = buildLagesredovisningRows(input, opts);
  assert.equal(row.period.inkubator, 0); // inget i okt–dec
  assert.equal(row.accumulated.inkubator, 15 * 641); // allt sedan programstart
});

// ── Statsstödsgrund → en rad per grund ───────────────────────────────────────

test('växling Art.22 → de minimis ger två rader med fördelade värden', () => {
  const input = baseInput({
    timeEntries: [
      { activity_kind: 'incubation', hours: 10, occurred_on: '2025-08-01' }, // Art22-fönster
      { activity_kind: 'incubation', hours: 20, occurred_on: '2025-11-01' } // de minimis-fönster
    ],
    stateAidPeriods: [
      { basis: 'art22', valid_from: '2025-07-01', valid_to: '2025-09-30' },
      { basis: 'de_minimis', sni_code: 'F.42.21', valid_from: '2025-10-01' }
    ]
  });
  const rows = buildLagesredovisningRows(input, OPTS);
  assert.equal(rows.length, 2);
  const art = rows.find((r) => r.basis === 'art22')!;
  const dm = rows.find((r) => r.basis === 'de_minimis')!;
  assert.equal(art.period.inkubator, 10 * 641);
  assert.equal(dm.period.inkubator, 20 * 641);
  assert.equal(dm.sni_code, 'F.42.21');
});

test('utan statsstödsperiod blir det en rad utan grund', () => {
  const rows = buildLagesredovisningRows(baseInput(), OPTS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].basis, null);
});

// ── Readiness ─────────────────────────────────────────────────────────────────

test('latestReadiness väljer senaste bedömningen', () => {
  const r = latestReadiness([
    { assessed_at: '2025-06-01', crl: 3 },
    { assessed_at: '2025-11-05', crl: 7 }
  ]);
  assert.equal(r?.crl, 7);
});

test('formatReadinessCell speglar Vinnova-formatet', () => {
  assert.equal(
    formatReadinessCell('crl', 7),
    'CRL 7. Customers in extended product testing or first test sales'
  );
  assert.equal(formatReadinessCell('crl', undefined), '');
  assert.equal(formatReadinessCell('srl', 1), 'SRL 1. None or very low awareness of how sustainability affects the planned business');
});

test('senaste readiness fyller radens RL-celler', () => {
  const input = baseInput({
    readiness: [{ assessed_at: '2025-11-05', crl: 7, tmrl: 5, brl: 6, srl: 4, criteria_checked_at: '2025-11-05' }]
  });
  const [row] = buildLagesredovisningRows(input, OPTS);
  assert.equal(row.crl, 7);
  assert.equal(row.criteria_checked_at, '2025-11-05');
  assert.ok(row.tmrl_cell.startsWith('TMRL 5.'));
});

// ── Validering ────────────────────────────────────────────────────────────────

test('de minimis utan SNI ger error', () => {
  const input = baseInput({
    stateAidPeriods: [{ basis: 'de_minimis', valid_from: '2025-07-01' }]
  });
  const [row] = buildLagesredovisningRows(input, OPTS);
  const issues = validateRow(row);
  assert.ok(issues.some((i) => i.field === 'sni_code' && i.severity === 'error'));
});

test('saknad org-nr ger error, saknad readiness ger warning', () => {
  const input = baseInput({ startup: { ...baseInput().startup, org_nr: '' } });
  const [row] = buildLagesredovisningRows(input, OPTS);
  const issues = validateRow(row);
  assert.ok(issues.some((i) => i.field === 'org_nr' && i.severity === 'error'));
  assert.ok(issues.some((i) => i.field === 'readiness' && i.severity === 'warning'));
});

// ── Aggregat ──────────────────────────────────────────────────────────────────

test('buildLagesredovisning summerar över alla bolag', () => {
  const a = baseInput({
    startup: { ...baseInput().startup, id: 'a', name: 'A' },
    timeEntries: [{ activity_kind: 'incubation', hours: 10, occurred_on: '2025-08-01' }]
  });
  const b = baseInput({
    startup: { ...baseInput().startup, id: 'b', name: 'B' },
    timeEntries: [{ activity_kind: 'incubation', hours: 20, occurred_on: '2025-08-01' }]
  });
  const res = buildLagesredovisning([a, b], OPTS);
  assert.equal(res.rows.length, 2);
  assert.equal(res.totals.inkubator, 30 * 641);
});

test('PROGRAM_START är programperiodens start', () => {
  assert.equal(PROGRAM_START, '2025-07-01');
});
