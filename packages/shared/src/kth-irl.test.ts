import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KTH_IRL_AXES,
  cleanIrlText,
  diffIrlProfiles,
  irlLevelDescription,
  irlNextStep,
  irlRadarPoints,
  irlRingPoints,
  normalizeIrlAxisNotes,
  normalizeIrlLevel,
  normalizeIrlProfile,
  summarizeIrl,
  validateIrlAssessmentInput
} from './kth-irl';

test('sex axlar i KTH-diagrammets ordning med nio nivåer var', () => {
  assert.deepEqual(
    KTH_IRL_AXES.map((a) => a.short),
    ['CRL', 'TMRL', 'BRL', 'IPRL', 'FRL', 'TRL']
  );
  for (const a of KTH_IRL_AXES) {
    assert.equal(a.levels.length, 9, a.key);
    assert.ok(a.levels.every((l) => l.trim().length > 0), a.key);
  }
});

test('normalizeIrlLevel godtar bara heltal 1–9', () => {
  assert.equal(normalizeIrlLevel(1), 1);
  assert.equal(normalizeIrlLevel('9'), 9);
  assert.equal(normalizeIrlLevel(0), null); // PB:s "tomt tal"
  assert.equal(normalizeIrlLevel(10), null);
  assert.equal(normalizeIrlLevel(4.5), null);
  assert.equal(normalizeIrlLevel(''), null);
  assert.equal(normalizeIrlLevel(null), null);
  assert.equal(normalizeIrlLevel('abc'), null);
});

test('normalizeIrlProfile släpper okända nycklar och tomma tal', () => {
  assert.deepEqual(normalizeIrlProfile({ crl: 8, trl: 9, tmrl: 0, srl: 4, foo: 3, brl: '6' }), {
    crl: 8,
    trl: 9,
    brl: 6
  });
  assert.deepEqual(normalizeIrlProfile(null), {});
});

test('validering: minst en axel, ogiltigt värde är fel, okänd axel är fel', () => {
  const today = '2026-10-15';
  assert.equal(validateIrlAssessmentInput({ levels: {} }, today).ok, false);
  const bad = validateIrlAssessmentInput({ levels: { crl: 11 } }, today);
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /Kund/);
  assert.equal(validateIrlAssessmentInput({ levels: { xrl: 3 } }, today).ok, false);
  assert.equal(validateIrlAssessmentInput({ levels: { crl: 3 }, srl: 12 }, today).ok, false);
  assert.equal(validateIrlAssessmentInput({ levels: { crl: 3 }, assessedAt: '2027-01-01' }, today).ok, false);
  assert.equal(validateIrlAssessmentInput({ levels: { crl: 3 }, assessedAt: 'igår' }, today).ok, false);

  const good = validateIrlAssessmentInput(
    {
      levels: { crl: 8, tmrl: 6, brl: 6, iprl: 7, frl: 5, trl: 9, extra: undefined } as Record<string, unknown>,
      srl: '4',
      axisNotes: { crl: '  Första order  från 19850101-1234 ', zzz: 'x' },
      note: 'Bra möte',
      assessedAt: '2026-10-01'
    },
    today
  );
  // "extra" är okänd → fel även när värdet är undefined.
  assert.equal(good.ok, false);
});

test('validering: normaliserar en giltig bedömning', () => {
  const res = validateIrlAssessmentInput(
    {
      levels: { crl: 8, tmrl: '6', brl: 6, iprl: 7, frl: 5, trl: 9 },
      srl: '4',
      axisNotes: { crl: '  Första order  från 19850101-1234 ', zzz: 'x' },
      note: 'Bra möte',
      assessedAt: '2026-10-01'
    },
    '2026-10-15'
  );
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.value.profile, { crl: 8, tmrl: 6, brl: 6, iprl: 7, frl: 5, trl: 9 });
  assert.equal(res.value.srl, 4);
  assert.deepEqual(res.value.axisNotes, { crl: 'Första order från [REDACTED]' });
  assert.equal(res.value.assessedAt, '2026-10-01');
  // Tomma axlar räknas som "ej bedömda", inte fel.
  const partial = validateIrlAssessmentInput({ levels: { crl: 2, trl: '' , brl: 0 } }, '2026-10-15');
  assert.ok(partial.ok);
  if (partial.ok) {
    assert.deepEqual(partial.value.profile, { crl: 2 });
    assert.equal(partial.value.assessedAt, '2026-10-15');
  }
});

test('summarizeIrl: medel, svagaste/starkaste och saknade axlar', () => {
  const s = summarizeIrl({ crl: 8, tmrl: 6, brl: 6, iprl: 7, frl: 5, trl: 9 });
  assert.equal(s.assessed, 6);
  assert.equal(s.average, 6.8);
  assert.deepEqual(s.weakest, ['frl']);
  assert.deepEqual(s.strongest, ['trl']);
  assert.deepEqual(s.missing, []);

  const partial = summarizeIrl({ crl: 3, trl: 3 });
  assert.deepEqual(partial.weakest, ['crl', 'trl']);
  assert.deepEqual(partial.strongest, []);
  assert.deepEqual(partial.missing, ['tmrl', 'brl', 'iprl', 'frl']);

  const empty = summarizeIrl({});
  assert.equal(empty.average, null);
  assert.equal(empty.missing.length, 6);
});

test('diffIrlProfiles räknar förändring bara när båda nivåerna finns', () => {
  const d = diffIrlProfiles({ crl: 4, trl: 6 }, { crl: 6, trl: 6, brl: 3 });
  const by = Object.fromEntries(d.map((x) => [x.key, x]));
  assert.equal(by.crl.delta, 2);
  assert.equal(by.trl.delta, 0);
  assert.equal(by.brl.delta, null);
  assert.equal(by.brl.to, 3);
});

test('nivåbeskrivning och nästa steg', () => {
  assert.equal(irlLevelDescription('crl', 8), 'Första produkterna sålda.');
  assert.equal(irlLevelDescription('crl', 0), null);
  assert.equal(irlNextStep('crl', 7), 'Första produkterna sålda.');
  assert.equal(irlNextStep('crl', 9), null);
  assert.equal(irlNextStep('crl', null), KTH_IRL_AXES[0].levels[0]);
});

test('radargeometri: kund uppåt, teknik uppe till vänster, saknad nivå i centrum', () => {
  const g = { cx: 100, cy: 100, r: 90 };
  const pts = irlRadarPoints({ crl: 9, trl: 9 }, g);
  const crl = pts.find((p) => p.key === 'crl')!;
  assert.deepEqual([crl.x, crl.y], [100, 10]);
  const trl = pts.find((p) => p.key === 'trl')!;
  assert.ok(trl.x < 100 && trl.y < 100);
  const iprl = pts.find((p) => p.key === 'iprl')!;
  assert.deepEqual([iprl.x, iprl.y, iprl.level], [100, 100, null]);
  assert.deepEqual([iprl.outerX, iprl.outerY], [100, 190]);
  assert.equal(irlRingPoints(9, g).split(' ')[0], '100,10');
});

test('cleanIrlText och axelnoteringar', () => {
  assert.equal(cleanIrlText('a\n\n b', 10), 'a b');
  assert.equal(cleanIrlText(42, 10), '');
  assert.equal(cleanIrlText('x'.repeat(20), 5), 'xxxxx');
  assert.deepEqual(normalizeIrlAxisNotes({ trl: ' ', brl: 'ok' }), { brl: 'ok' });
});
