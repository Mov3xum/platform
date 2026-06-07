import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DE_MINIMIS_REGELVERK,
  SAMLAT_TAK_EUR,
  FORORDNING_KODER,
  forordningLabels,
  parseDateOnly,
  subYears,
  rullandeSummaForordning,
  samladSumma,
  warningLevel,
  summarize,
  kanBevilja,
  validateStodInput,
  effektivBeloppSek,
  samladSummaSek,
  DE_MINIMIS_TEMPLATES,
  findDeMinimisTemplate,
  type DeMinimisStodCalc
} from './de-minimis.ts';

const REG = DEFAULT_DE_MINIMIS_REGELVERK;

function stod(
  forordning: DeMinimisStodCalc['forordning'],
  belopp_eur: number,
  beslutsdatum: string
): DeMinimisStodCalc {
  return { forordning, belopp_eur, beslutsdatum };
}

// ── Datum-hjälpare ────────────────────────────────────────────────────────────

test('parseDateOnly accepterar YYYY-MM-DD och full ISO', () => {
  assert.equal(parseDateOnly('2026-05-30')?.getTime(), Date.UTC(2026, 4, 30));
  assert.equal(parseDateOnly('2026-05-30 00:00:00.000Z')?.getTime(), Date.UTC(2026, 4, 30));
  assert.equal(parseDateOnly(''), null);
  assert.equal(parseDateOnly(null), null);
});

test('subYears drar av rätt antal år', () => {
  const d = new Date(Date.UTC(2026, 4, 30));
  assert.equal(subYears(d, 3).getTime(), Date.UTC(2023, 4, 30));
});

// ── Rullande summa per förordning ─────────────────────────────────────────────

test('rullande 3-år summerar bara poster inom fönstret (ALLMAN)', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [
    stod('ALLMAN', 100000, '2025-01-01'), // inom
    stod('ALLMAN', 50000, '2024-06-01'), // inom
    stod('ALLMAN', 20000, '2023-01-01'), // utanför (> 3 år)
    stod('SGEI', 99999, '2025-01-01') // annan förordning
  ];
  assert.equal(rullandeSummaForordning(data, 'ALLMAN', 'RULLANDE_3AR', ref), 150000);
});

test('post exakt 3 år tillbaka faller utanför (strikt >)', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [stod('ALLMAN', 10000, '2023-05-30')];
  assert.equal(rullandeSummaForordning(data, 'ALLMAN', 'RULLANDE_3AR', ref), 0);
  const data2 = [stod('ALLMAN', 10000, '2023-05-31')];
  assert.equal(rullandeSummaForordning(data2, 'ALLMAN', 'RULLANDE_3AR', ref), 10000);
});

test('beskattningsår: innevarande + två föregående (JORDBRUK)', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [
    stod('JORDBRUK', 10000, '2026-02-01'), // innevarande
    stod('JORDBRUK', 10000, '2024-01-01'), // två tillbaka — inom
    stod('JORDBRUK', 10000, '2023-12-31') // tre tillbaka — utanför
  ];
  assert.equal(rullandeSummaForordning(data, 'JORDBRUK', 'BESKATTNINGSAR_3', ref), 20000);
});

// ── Samlad summa ──────────────────────────────────────────────────────────────

test('samlad summa räknar in sektorstöd mot 300k', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [
    stod('ALLMAN', 250000, '2025-01-01'),
    stod('JORDBRUK', 40000, '2025-06-01'),
    stod('FISKE', 20000, '2024-01-01')
  ];
  assert.equal(samladSumma(data, ref), 310000);
});

// ── Varningsnivåer ────────────────────────────────────────────────────────────

test('warningLevel-trösklar', () => {
  assert.equal(warningLevel(0, 100), 'ok');
  assert.equal(warningLevel(79, 100), 'ok');
  assert.equal(warningLevel(80, 100), 'warn');
  assert.equal(warningLevel(94, 100), 'warn');
  assert.equal(warningLevel(95, 100), 'critical');
  assert.equal(warningLevel(100, 100), 'critical');
  assert.equal(warningLevel(101, 100), 'over');
});

// ── Summering (UI-aggregat) ──────────────────────────────────────────────────

test('summarize ger fyra förordningar + samlad rad med rätt tak', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [stod('ALLMAN', 150000, '2025-01-01'), stod('SGEI', 75000, '2025-01-01')];
  const { perForordning, samlat } = summarize(data, REG, ref);
  assert.equal(perForordning.length, 4);
  const allman = perForordning.find((p) => p.kod === 'ALLMAN')!;
  assert.equal(allman.used, 150000);
  assert.equal(allman.cap, 300000);
  assert.equal(allman.remaining, 150000);
  assert.equal(allman.pct, 50);
  const sgei = perForordning.find((p) => p.kod === 'SGEI')!;
  assert.equal(sgei.cap, 750000);
  assert.equal(samlat.used, 225000);
  assert.equal(samlat.cap, SAMLAT_TAK_EUR);
});

// ── kanBevilja ───────────────────────────────────────────────────────────────

test('kanBevilja tillåter inom både förordnings- och samlat tak', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [stod('ALLMAN', 100000, '2025-01-01')];
  const r = kanBevilja(data, REG, 'ALLMAN', 100000, ref);
  assert.equal(r.ok, true);
  assert.equal(r.utrymmeForordning, 200000);
  assert.equal(r.overskridsForordningMed, 0);
});

test('kanBevilja blockerar när förordningstaket överskrids', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const data = [stod('JORDBRUK', 45000, '2026-01-01')];
  const r = kanBevilja(data, REG, 'JORDBRUK', 10000, ref);
  assert.equal(r.ok, false);
  assert.equal(r.overskridsForordningMed, 5000); // 55000 - 50000
});

test('kanBevilja blockerar när samlat tak överskrids även om förordningstaket har utrymme', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  // SGEI-taket är 750k, men samlat tak är 300k.
  const data = [stod('SGEI', 280000, '2025-01-01')];
  const r = kanBevilja(data, REG, 'SGEI', 40000, ref);
  assert.equal(r.ok, false);
  assert.equal(r.overskridsForordningMed, 0); // 320k < 750k förordningstak
  assert.equal(r.overskridsSamlatMed, 20000); // 320k - 300k samlat tak
});

// ── Validering ────────────────────────────────────────────────────────────────

test('validateStodInput godkänner en giltig post', () => {
  const r = validateStodInput(
    { forordning: 'ALLMAN', belopp_eur: 1000, beslutsdatum: '2026-01-01', stodgivare: 'Vinnova' },
    { today: new Date(Date.UTC(2026, 4, 30)) }
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.warnings.length, 0);
});

test('validateStodInput avvisar belopp <= 0', () => {
  const r = validateStodInput({
    forordning: 'ALLMAN',
    belopp_eur: 0,
    beslutsdatum: '2026-01-01',
    stodgivare: 'Vinnova'
  });
  assert.equal(r.ok, false);
});

test('validateStodInput avvisar framtida beslutsdatum', () => {
  const r = validateStodInput(
    { forordning: 'ALLMAN', belopp_eur: 1000, beslutsdatum: '2027-01-01', stodgivare: 'Vinnova' },
    { today: new Date(Date.UTC(2026, 4, 30)) }
  );
  assert.equal(r.ok, false);
});

test('validateStodInput avvisar okänd förordning', () => {
  const r = validateStodInput({
    forordning: 'NONSENS',
    belopp_eur: 1000,
    beslutsdatum: '2026-01-01',
    stodgivare: 'Vinnova'
  });
  assert.equal(r.ok, false);
});

test('validateStodInput varnar (men blockerar ej) vid bakåtdaterad post', () => {
  const r = validateStodInput(
    { forordning: 'ALLMAN', belopp_eur: 1000, beslutsdatum: '2024-01-01', stodgivare: 'Vinnova' },
    { today: new Date(Date.UTC(2026, 4, 30)), latestExistingDate: '2025-06-01' }
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.warnings.length, 1);
});

// ── Konsistens ────────────────────────────────────────────────────────────────

test('varje förordningskod har en etikett och en regel', () => {
  for (const kod of FORORDNING_KODER) {
    assert.equal(typeof forordningLabels[kod], 'string');
    assert.ok(REG.find((r) => r.kod === kod));
  }
});

// ── Stödgivar-mallar ──────────────────────────────────────────────────────────

test('alla mallar har unik id och giltig förordning', () => {
  const ids = new Set<string>();
  for (const t of DE_MINIMIS_TEMPLATES) {
    assert.ok(t.id && !ids.has(t.id), `dubblett-id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.stodgivare.trim().length > 0);
    assert.ok(FORORDNING_KODER.includes(t.forordning));
  }
  assert.ok(DE_MINIMIS_TEMPLATES.length >= 5);
});

test('findDeMinimisTemplate slår upp och returnerar undefined för okänt id', () => {
  assert.equal(findDeMinimisTemplate('vinnova')?.stodgivare, 'Vinnova');
  assert.equal(findDeMinimisTemplate('finns-inte'), undefined);
});

// ── SEK-belopp ────────────────────────────────────────────────────────────────

test('effektivBeloppSek använder explicit SEK före härledning', () => {
  assert.equal(effektivBeloppSek({ belopp_sek: 1000, belopp_eur: 90, valutakurs: 11 }), 1000);
});

test('effektivBeloppSek härleder ur EUR × kurs när SEK saknas', () => {
  assert.equal(effektivBeloppSek({ belopp_eur: 100, valutakurs: 11.3 }), 1130);
});

test('effektivBeloppSek returnerar null när SEK ej kan bestämmas', () => {
  assert.equal(effektivBeloppSek({ belopp_eur: 100 }), null);
  assert.equal(effektivBeloppSek({}), null);
});

test('samladSummaSek summerar inom 3-årsfönstret och flaggar ofullständighet', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const rows = [
    { belopp_sek: 1000, beslutsdatum: '2025-01-01' },
    { belopp_eur: 100, valutakurs: 11, beslutsdatum: '2025-06-01' }, // 1100 SEK
    { belopp_eur: 50, beslutsdatum: '2025-07-01' } // saknar kurs → ofullständig
  ];
  const r = samladSummaSek(rows, ref);
  assert.equal(r.sek, 2100);
  assert.equal(r.complete, false);
});

test('samladSummaSek exkluderar poster utanför 3-årsfönstret', () => {
  const ref = new Date(Date.UTC(2026, 4, 30));
  const rows = [
    { belopp_sek: 5000, beslutsdatum: '2020-01-01' }, // för gammal
    { belopp_sek: 2000, beslutsdatum: '2026-01-01' }
  ];
  const r = samladSummaSek(rows, ref);
  assert.equal(r.sek, 2000);
  assert.equal(r.complete, true);
});
