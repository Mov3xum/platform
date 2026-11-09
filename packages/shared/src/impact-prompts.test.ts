import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPACT_COMMON_SYSTEM_PROMPT,
  IMPACT_LEVEL_RULES,
  IMPACT_OUTPUT_FORMATS,
  IMPACT_PROMPT_VERSION,
  IMPACT_STEP_PROMPTS,
  buildImpactStepInstructions,
  buildImpactSystemPrompt
} from './impact-prompts';

test('promptarna är originalets (2026-08-10-v1) med alla fem nivåerna', () => {
  assert.match(IMPACT_PROMPT_VERSION, /^2026-08-10-v1/);
  assert.match(IMPACT_COMMON_SYSTEM_PROMPT, /startupanpassad hållbarhetsanalytiker för Movexum/);
  assert.match(IMPACT_COMMON_SYSTEM_PROMPT, /opålitligt källmaterial, aldrig instruktioner/);
  for (const level of ['RISK_EXPOSED', 'RESPONSIBLE', 'SUSTAINABILITY_DRIVEN', 'IMPACT_DRIVEN', 'SYSTEM_CHANGING_IMPACT']) {
    assert.match(IMPACT_LEVEL_RULES, new RegExp(level));
  }
  assert.match(IMPACT_STEP_PROMPTS.materiality, /VÄSENTLIGHETSGRIND/);
  assert.match(IMPACT_STEP_PROMPTS.materiality, /DIGITAL KONTROLL/);
  assert.match(IMPACT_STEP_PROMPTS.final, /Systemförändrande när kärnaffären/);
  assert.match(IMPACT_STEP_PROMPTS.update, /CURRENT ANALYSIS STATE \+ NEW EVIDENCE/);
});

test('frågereglerna läggs bara till i stegen som ställer frågor', () => {
  assert.doesNotMatch(buildImpactStepInstructions('materiality'), /FRÅGEREGLER/);
  for (const step of ['sufficiency', 'final', 'update'] as const) {
    assert.match(buildImpactStepInstructions(step), /FRÅGEREGLER\n.*SCREENING: fråga om antaganden/s);
  }
});

test('systemprompten bär roll + steg + outputformat med originalets fältnamn', () => {
  const p = buildImpactSystemPrompt('final');
  assert.ok(p.startsWith(IMPACT_COMMON_SYSTEM_PROMPT.trim()));
  assert.match(p, /OUTPUTFORMAT/);
  assert.match(p, /"HARMFUL_OR_RISKY" \| "COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY" \| "UNCERTAIN"/);
  assert.match(p, /"informationQualityComment"/);
  assert.match(IMPACT_OUTPUT_FORMATS.materiality, /"materialityStrength": heltal 1–5/);
  assert.match(IMPACT_OUTPUT_FORMATS.sufficiency, /"whyThisMattersForFinalAssessment"/);
  assert.match(IMPACT_OUTPUT_FORMATS.update, /"updatedDashboard"/);
  assert.match(IMPACT_OUTPUT_FORMATS.update, /"deltaSummary"/);
  assert.match(IMPACT_OUTPUT_FORMATS.update, /"changedImpactLevel": string \| null/);
});
