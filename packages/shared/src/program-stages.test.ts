import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAM_STAGES,
  PROGRAM_STAGE_PHASES,
  irlAverageByStartup,
  programStageOfPhase,
  summarizeProgramStages
} from './program-stages.ts';
import { ALL_PHASES } from './index.ts';

test('varje fas utom paus hör till exakt ett programsteg', () => {
  for (const phase of ALL_PHASES) {
    const stages = PROGRAM_STAGES.filter((s) => PROGRAM_STAGE_PHASES[s].includes(phase));
    if (phase === 'paus') {
      assert.equal(stages.length, 0);
      assert.equal(programStageOfPhase(phase), null);
    } else {
      assert.equal(stages.length, 1, `fasen ${phase} ska höra till exakt ett steg`);
      assert.equal(programStageOfPhase(phase), stages[0]);
    }
  }
  assert.equal(programStageOfPhase('okänd'), null);
  assert.equal(programStageOfPhase(undefined), null);
});

test('irlAverageByStartup väljer senaste bedömningen med KTH-axel per bolag', () => {
  const rows = [
    // Äldre rad med högre nivåer — ska inte vinna.
    { startup: 'a', assessed_at: '2026-01-10 00:00:00', crl: 7, trl: 7 },
    // Senaste raden: snitt (3+5)/2 = 4
    { startup: 'a', assessed_at: '2026-03-01 00:00:00', crl: 3, brl: 5 },
    // Bara SRL (Vinnova-inmatning) — ingen KTH-axel → inget värde.
    { startup: 'b', assessed_at: '2026-02-01 00:00:00', srl: 4 },
    // 0 = ej bedömd (PB lagrar 0 för tomt tal) — ignoreras.
    { startup: 'c', assessed_at: '2026-02-01 00:00:00', crl: 0, tmrl: 6 },
    { assessed_at: '2026-02-01 00:00:00', crl: 9 },
    null
  ];
  const map = irlAverageByStartup(rows);
  assert.equal(map.get('a'), 4);
  assert.equal(map.has('b'), false);
  assert.equal(map.get('c'), 6);
  assert.equal(map.size, 2);
});

test('summarizeProgramStages räknar bolag per steg och IRL bara för bedömda', () => {
  const startups = [
    { id: 's1', phase: 'boost_chamber' },
    { id: 's2', phase: 'lead' },
    { id: 's3', phase: 'incubation' },
    { id: 's4', phase: 'prescale' },
    { id: 's5', phase: 'acceleration' },
    { id: 's6', phase: 'alumni' },
    { id: 's7', phase: 'paus' }
  ];
  const irl = new Map<string, number>([
    ['s1', 2],
    ['s3', 4.5],
    ['s4', 6],
    ['s5', 8]
  ]);
  const o = summarizeProgramStages(startups, irl);
  const by = Object.fromEntries(o.stages.map((s) => [s.stage, s]));
  assert.equal(by.formation.count, 2);
  assert.equal(by.formation.pct, 29);
  assert.equal(by.formation.assessed, 1);
  assert.equal(by.formation.irlAverage, 2);
  assert.equal(by.incubation.irlAverage, 4.5);
  assert.equal(by.acceleration.count, 2);
  assert.equal(by.acceleration.irlAverage, 7);
  assert.equal(by.alumni.count, 1);
  assert.equal(by.alumni.irlAverage, null, 'ingen bedömning ⇒ null, aldrig 0');
  assert.equal(o.unstaged, 1);
  assert.equal(o.assessed, 4);
  assert.equal(o.irlAverage, 5.1);
});

test('tom portfölj ger nollor och null', () => {
  const o = summarizeProgramStages([], new Map());
  assert.equal(o.stages.length, 4);
  assert.ok(o.stages.every((s) => s.count === 0 && s.pct === 0 && s.irlAverage === null));
  assert.equal(o.irlAverage, null);
});
