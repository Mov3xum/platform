import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_IMPACT_BASIS_TOKENS,
  AI_IMPACT_CO2_GRAMS_PER_BASIS,
  AI_IMPACT_WATER_ML_PER_BASIS,
  co2GramsForTokens,
  waterMlForTokens,
  aiImpactForTokens,
  formatTokens,
  formatCo2Grams,
  formatWaterMl,
  formatAiImpact
} from './ai-impact.ts';

// ── Beräkning (Mistrals officiella siffror: 400 tokens → 1,14 g / 45 ml) ─────

test('exakt basen: 400 tokens → 1,14 g CO₂e och 45 ml vatten', () => {
  assert.equal(AI_IMPACT_BASIS_TOKENS, 400);
  assert.equal(co2GramsForTokens(400), AI_IMPACT_CO2_GRAMS_PER_BASIS);
  assert.equal(waterMlForTokens(400), AI_IMPACT_WATER_ML_PER_BASIS);
});

test('skalar linjärt med tokenantal', () => {
  assert.equal(co2GramsForTokens(800), 2.28);
  assert.equal(waterMlForTokens(800), 90);
  assert.equal(co2GramsForTokens(200), 0.57);
  assert.equal(waterMlForTokens(200), 22.5);
  // 1M tokens → 2 850 g CO₂e / 112 500 ml vatten (flyttals-tolerans)
  assert.ok(Math.abs(co2GramsForTokens(1_000_000) - 2850) < 1e-9);
  assert.equal(waterMlForTokens(1_000_000), 112_500);
});

test('ogiltiga/negativa tokens behandlas som 0', () => {
  assert.equal(co2GramsForTokens(0), 0);
  assert.equal(co2GramsForTokens(-100), 0);
  assert.equal(co2GramsForTokens(null), 0);
  assert.equal(co2GramsForTokens(undefined), 0);
  assert.equal(co2GramsForTokens(NaN), 0);
  assert.equal(waterMlForTokens(-1), 0);
});

test('aiImpactForTokens returnerar samlad struktur', () => {
  const impact = aiImpactForTokens(400);
  assert.equal(impact.tokens, 400);
  assert.equal(impact.co2Grams, 1.14);
  assert.equal(impact.waterMl, 45);
});

// ── Formattering (svensk) ────────────────────────────────────────────────────

test('formatTokens använder svensk tusentalsavgränsning', () => {
  // sv-SE använder non-breaking space som tusentalsavgränsare.
  assert.equal(formatTokens(12400).replace(/\s/g, ' '), '12 400');
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(null), '0');
});

test('formatCo2Grams växlar enhet g → kg', () => {
  assert.equal(formatCo2Grams(0), '0 g CO₂e');
  assert.equal(formatCo2Grams(0.57), '0,57 g CO₂e');
  assert.equal(formatCo2Grams(1.14), '1,1 g CO₂e');
  assert.equal(formatCo2Grams(999), '999 g CO₂e');
  assert.equal(formatCo2Grams(2850), '2,9 kg CO₂e');
});

test('formatWaterMl växlar enhet ml → l', () => {
  assert.equal(formatWaterMl(0), '0 ml vatten');
  assert.equal(formatWaterMl(45), '45 ml vatten');
  assert.equal(formatWaterMl(999), '999 ml vatten');
  assert.equal(formatWaterMl(112_500).replace(/\s/g, ' '), '112,5 l vatten');
});

test('formatAiImpact ger kompakt chip-etikett', () => {
  assert.equal(formatAiImpact(400), '≈ 1,1 g CO₂e · 45 ml vatten');
  assert.equal(formatAiImpact(0), '≈ 0 g CO₂e · 0 ml vatten');
});
