import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPACT_ASSESSMENT_STATUSES,
  IMPACT_COMPANY_STATUSES,
  IMPACT_GAP_SEVERITIES,
  IMPACT_GAP_STATUSES,
  IMPACT_INPUT_MAX_CHARS,
  IMPACT_JOB_TYPES,
  IMPACT_UPLOAD_STAGES,
  applyImpactOverrides,
  buildImpactInput,
  canManageImpact,
  canReadImpact,
  impactCompanyStatusFor,
  impactNextStep,
  normalizeImpactDashboard,
  normalizeImpactMateriality,
  normalizeImpactSufficiency,
  normalizeImpactUpdateDelta,
  parseImpactModelJson
} from './impact-navigator';

test('vokabulären speglar migration 1700000206 (gemener av källans enum)', () => {
  assert.deepEqual([...IMPACT_COMPANY_STATUSES], ['draft', 'materiality_review', 'info_collection', 'needs_more_info', 'analyzed']);
  assert.deepEqual(
    [...IMPACT_ASSESSMENT_STATUSES],
    ['materiality_pending', 'materiality_review', 'info_pending', 'needs_more_info', 'final_pending', 'complete', 'failed']
  );
  assert.deepEqual([...IMPACT_GAP_SEVERITIES], ['required', 'recommended']);
  assert.deepEqual([...IMPACT_GAP_STATUSES], ['open', 'answered', 'not_available']);
  assert.deepEqual([...IMPACT_UPLOAD_STAGES], ['idea_description', 'full_information', 'gap_response', 'update']);
  assert.deepEqual([...IMPACT_JOB_TYPES], ['materiality', 'sufficiency', 'final_analysis', 'update_analysis']);
});

test('roller: personal driver, observer läser, bolagsmedlem inget', () => {
  assert.equal(canManageImpact(['coach']), true);
  assert.equal(canManageImpact(['observer']), false);
  assert.equal(canReadImpact(['observer']), true);
  assert.equal(canReadImpact(['startup_member']), false);
  assert.equal(canReadImpact(undefined), false);
});

test('normalizeImpactMateriality: tolererar skräp, härleder kategori ur kod, cappar', () => {
  const m = normalizeImpactMateriality({
    companySummary: 'Bolaget …',
    selectedAspects: [
      { code: 'own-env-01', name: 'Materialeffektivitet', status: 'material', confidence: 85, evidence: [{ note: 'n', excerpt: 'e', documentName: 'd.pdf' }, 'bara text'] },
      { code: '???', category: 'Social', name: 'Trygg användning', status: 'UNCERTAIN', materialityStrength: 'high' },
      'nonsens'
    ],
    consideredButNotMaterial: [{ code: 'OWN-GOV-02', name: 'Leverantörsled', rationale: 'r' }],
    warnings: ['w', 5, null],
    assumptions: 'inte en lista'
  });
  assert.equal(m.selectedAspects.length, 3);
  assert.equal(m.selectedAspects[0].code, 'OWN-ENV-01');
  assert.equal(m.selectedAspects[0].category, 'ENVIRONMENT');
  assert.equal(m.selectedAspects[0].status, 'MATERIAL');
  assert.equal(m.selectedAspects[0].confidence, 0.85);
  assert.equal(m.selectedAspects[0].evidence.length, 2);
  assert.equal(m.selectedAspects[1].code, 'OWN-SOC-02');
  assert.equal(m.selectedAspects[1].category, 'SOCIAL');
  assert.equal(m.selectedAspects[1].materialityStrength, 'HIGH');
  assert.equal(m.selectedAspects[2].name, 'Namnlös aspekt');
  assert.equal(m.consideredButNotMaterial[0].category, 'GOVERNANCE');
  assert.deepEqual(m.warnings, ['w']);
  assert.deepEqual(m.assumptions, []);
});

test('normalizeImpactSufficiency: frågor med allvarlighetsgrad, ready bara vid true', () => {
  const s = normalizeImpactSufficiency({
    readyForFinalAnalysis: 'true',
    overallInformationQuality: 268,
    aspectChecks: [
      { code: 'OWN-GOV-01', name: 'Ansvar', question: { question: 'Hur?', severity: 'required', missingInformation: 'x' } },
      { code: 'OWN-SOC-01', name: 'Trygghet', question: 'Vad?' },
      { code: 'OWN-ENV-01', name: 'Material' }
    ]
  });
  assert.equal(s.readyForFinalAnalysis, false);
  assert.equal(s.overallInformationQuality, 100);
  assert.equal(s.aspectChecks[0].question?.severity, 'required');
  assert.equal(s.aspectChecks[1].question?.question, 'Vad?');
  assert.equal(s.aspectChecks[1].question?.severity, 'recommended');
  assert.equal(s.aspectChecks[2].question, null);
});

test('normalizeImpactDashboard: etikett följer nivån, okända värden faller tillbaka, disclaimer alltid', () => {
  const d = normalizeImpactDashboard({
    executiveSummary: 'Sammanfattning',
    impactLevel: { level: 'impact-driven', labelSv: 'fel etikett', rationale: 'r' },
    businessModelCompatibility: { status: 'weird' },
    risks: [{ title: 'Risk', aspectCode: 'OWN-SOC-01', severity: 'extreme', timeHorizon: 'short', evidence: ['e'] }, { title: '' }],
    opportunities: [{ title: 'Chans', category: 'ENVIRONMENT', potential: 'HIGH' }],
    whatCompanyNeedsToWorkOn: [{ title: 'Gör', priority: 'LOW' }],
    informationQualityScore: '62',
    areaAssessments: { social: { assessment: 'a', potentialLabel: 'p', uncertaintyNotes: ['u'] } }
  });
  assert.equal(d.impactLevel.level, 'IMPACT_DRIVEN');
  assert.equal(d.impactLevel.labelSv, 'Impactdrivande');
  assert.equal(d.businessModelCompatibility.status, 'UNCERTAIN');
  assert.equal(d.risks.length, 1);
  assert.equal(d.risks[0].category, 'SOCIAL');
  assert.equal(d.risks[0].severity, 'MEDIUM');
  assert.equal(d.risks[0].timeHorizon, 'SHORT');
  assert.equal(d.opportunities[0].potential, 'HIGH');
  assert.equal(d.whatCompanyNeedsToWorkOn[0].priority, 'LOW');
  assert.equal(d.informationQualityScore, 62);
  assert.equal(d.areaAssessments.social.potentialLabel, 'p');
  assert.equal(d.areaAssessments.environment.assessment, '');
  assert.match(d.disclaimer, /Genererat av AI/);
});

test('normalizeImpactUpdateDelta + parseImpactModelJson', () => {
  const raw = parseImpactModelJson('Här är svaret:\n```json\n{"newRisks":["a"],"reducedRisks":[],"whatChangedSinceLastAssessment":["b"]}\n```');
  const u = normalizeImpactUpdateDelta(raw);
  assert.deepEqual(u.newRisks, ['a']);
  assert.deepEqual(u.whatChangedSinceLastAssessment, ['b']);
  assert.deepEqual(u.newOpportunities, []);
  assert.equal(parseImpactModelJson('inget json här'), null);
  assert.equal(parseImpactModelJson('{"trasig": '), null);
});

test('applyImpactOverrides: flyttar aspekter åt båda hållen, bokför bara ändringar', () => {
  const m = normalizeImpactMateriality({
    selectedAspects: [{ code: 'OWN-SOC-01', name: 'A', category: 'SOCIAL', status: 'MATERIAL' }, { code: 'OWN-GOV-01', name: 'B', category: 'GOVERNANCE', status: 'UNCERTAIN' }],
    consideredButNotMaterial: [{ code: 'OWN-ENV-01', name: 'C', category: 'ENVIRONMENT', rationale: 'ej' }]
  });
  const { materiality, applied } = applyImpactOverrides(m, [
    { aspectCode: 'own-soc-01', newStatus: 'NOT_MATERIAL', comment: 'Inte relevant i fasen' },
    { aspectCode: 'OWN-GOV-01', newStatus: 'UNCERTAIN' },
    { aspectCode: 'OWN-ENV-01', newStatus: 'MATERIAL' },
    { aspectCode: 'OWN-XXX-09', newStatus: 'MATERIAL' }
  ]);
  assert.deepEqual(
    applied,
    [
      { aspectCode: 'OWN-SOC-01', originalStatus: 'MATERIAL', newStatus: 'NOT_MATERIAL' },
      { aspectCode: 'OWN-ENV-01', originalStatus: 'NOT_MATERIAL', newStatus: 'MATERIAL' }
    ]
  );
  assert.deepEqual(materiality.selectedAspects.map((a) => a.code), ['OWN-GOV-01', 'OWN-ENV-01']);
  assert.deepEqual(materiality.consideredButNotMaterial.map((a) => [a.code, a.rationale]), [['OWN-SOC-01', 'Inte relevant i fasen']]);
});

test('statusmaskinen', () => {
  assert.equal(impactCompanyStatusFor('materiality_review'), 'materiality_review');
  assert.equal(impactCompanyStatusFor('final_pending'), 'info_collection');
  assert.equal(impactCompanyStatusFor('complete'), 'analyzed');
  assert.equal(impactNextStep('materiality_pending', 0), 'run_materiality');
  assert.equal(impactNextStep('needs_more_info', 2), 'answer_gaps');
  assert.equal(impactNextStep('needs_more_info', 0), 'run_sufficiency');
  assert.equal(impactNextStep('complete', 0), 'done');
});

test('buildImpactInput: cappar och märker kapade dokument, listar använda', () => {
  const big = 'x'.repeat(IMPACT_INPUT_MAX_CHARS);
  const r = buildImpactInput({
    companyName: 'Tooly AB',
    phase: 'lead',
    industry: 'Delning',
    journeyText: 'Resa',
    documents: [
      { name: 'Idé.pdf', stage: 'idea_description', text: 'kort' },
      { name: 'A.pdf', stage: 'full_information', text: big },
      { name: 'B.pdf', stage: 'full_information', text: big },
      { name: 'C.pdf', stage: 'update', text: big },
      { name: 'D.pdf', stage: 'update', text: 'ryms inte' }
    ],
    gapAnswers: [{ question: 'F?', answer: 'S.' }],
    updateNarrative: 'Nytt'
  });
  assert.equal(r.truncated, true);
  assert.deepEqual(r.documentNames, ['Idé.pdf', 'A.pdf', 'B.pdf', 'C.pdf']);
  assert.ok(r.text.length <= IMPACT_INPUT_MAX_CHARS + 100);
  assert.match(r.text, /Svar på tidigare kompletteringsfrågor/);
  assert.match(r.text, /bolagets uppdatering/);
  assert.match(r.text, /dokumentet kapat/);
});
