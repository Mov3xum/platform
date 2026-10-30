import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPACT_DOCUMENT_TEXT_LIMIT,
  buildImpactDocumentEvidence,
  buildImpactFinalAnalysisAIInput,
  buildImpactMaterialityAIInput,
  buildImpactSufficiencyAIInput,
  buildImpactUpdateAnalysisAIInput
} from './impact-inputs';
import { normalizeImpactDashboard, normalizeImpactMateriality, normalizeImpactSufficiency } from './impact-navigator';

test('buildImpactDocumentEvidence: dedupe, exkluderade texter, teckentak med kapning', () => {
  const docs = [
    { originalName: 'A.pdf', extractedText: 'Samma text\r\n' },
    { originalName: 'B.pdf', extractedText: 'Samma text' },
    { originalName: '', extractedText: 'Annan text' },
    { originalName: 'C.pdf', extractedText: null },
    { originalName: 'D.pdf', extractedText: 'Känd' }
  ];
  const ev = buildImpactDocumentEvidence(docs, { excludeTexts: ['Känd'] });
  assert.deepEqual(ev, [
    { sourceLabel: 'Dokument: A.pdf', text: 'Samma text' },
    { sourceLabel: 'Dokument: Namnlöst dokument', text: 'Annan text' }
  ]);
  const capped = buildImpactDocumentEvidence([{ originalName: 'X', extractedText: 'y'.repeat(100) }, { originalName: 'Z', extractedText: 'z' }], { maxCharacters: 60 });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].text.length, 60 - 'Dokument: X'.length);
  assert.equal(IMPACT_DOCUMENT_TEXT_LIMIT, 60_000);
});

const materiality = normalizeImpactMateriality({
  companySummary: 'S',
  sustainabilityPerspectiveSummary: 'P',
  selectedAspects: [
    { code: 'OWN-ENV-01', name: 'Hosting', category: 'ENVIRONMENT', status: 'MATERIAL', uncertaintyNotes: ['u1'] },
    { code: 'CUS-01', name: 'Gammalt', category: 'CUSTOM', status: 'MATERIAL', uncertaintyNotes: [] }
  ],
  assumptions: ['a']
});

test('buildImpactMaterialityAIInput: resan exkluderas ur evidensen, referensområden följer med', () => {
  const input = buildImpactMaterialityAIInput({
    name: ' Tooly AB ',
    phase: 'SCREENING',
    industry: 'Delning',
    journeyText: 'Resan\r\n',
    documents: [{ originalName: 'Idé.pdf', extractedText: 'Resan' }, { originalName: 'Pitch.pdf', extractedText: 'Pitch' }],
    referenceMaterialityAreas: [{ code: 'E1', name: 'Klimatförändringar', category: 'ENVIRONMENT' }]
  });
  assert.equal(input.company.name, 'Tooly AB');
  assert.equal(input.company.businessDescription, 'Resan');
  assert.deepEqual(input.initialEvidence.map((e) => e.sourceLabel), ['Dokument: Pitch.pdf']);
  assert.equal(input.referenceMaterialityAreas?.length, 1);
});

test('buildImpactSufficiencyAIInput: CUSTOM normaliseras med not, bara ny evidens skickas', () => {
  const input = buildImpactSufficiencyAIInput({
    phase: 'INKUBATOR',
    materiality,
    newDocuments: [{ originalName: 'Ny.pdf', extractedText: 'Nytt' }, { originalName: 'Gammal.pdf', extractedText: 'Känd' }],
    knownEvidenceTexts: ['Känd']
  });
  assert.equal(input.materiality.selectedAspects[1].category, 'SOCIAL'); // CUS = customer → SOCIAL (originalets regex)
  assert.match(input.materiality.selectedAspects[1].uncertaintyNotes[0], /CUSTOM-kategori har normaliserats/);
  assert.match(input.materiality.assumptions[1], /modern huvudkategori/);
  assert.deepEqual(input.newEvidence.map((e) => e.text), ['Nytt']);
});

test('buildImpactFinalAnalysisAIInput: gap-status följer det som lämnades, hasReadableDocumentEvidence, dedupe mot kända texter', () => {
  const sufficiency = normalizeImpactSufficiency({
    readyForFinalAnalysis: true,
    overallInformationQuality: 70,
    aspectChecks: [{ code: 'OWN-ENV-01', informationStatus: 'PARTIAL', whatWeKnow: ['k'], missingInformation: ['m'], confidence: 'LOW' }]
  });
  const input = buildImpactFinalAnalysisAIInput({
    companyName: 'Tooly',
    phase: 'SCREENING',
    industry: 'Delning',
    materiality,
    sufficiency,
    gapResponses: [
      { areaCode: 'OWN-ENV-01', question: 'Hur hostar ni?', status: 'open', answerText: '  Hos Hetzner. ', documents: [] },
      { areaCode: 'CUS-01', question: 'Vad?', status: 'open', answerText: '', documents: [{ originalName: 'Känd.pdf', extractedText: 'Känd' }] },
      { areaCode: 'OWN-GOV-01', question: 'Avtal?', status: 'not_available', answerText: 'finns ej', documents: [] },
      { areaCode: 'OWN-SOC-01', question: 'Trygghet?', status: 'answered', answerText: '', documents: [] }
    ],
    knownEvidenceTexts: ['Känd']
  });
  assert.equal(input.informationStatus.overallInformationQuality, 70);
  assert.equal(input.informationStatus.aspectChecks[0].confidence, 'LOW');
  assert.deepEqual(input.gapResponses.map((g) => g.status), ['ANSWERED', 'ANSWERED', 'NOT_AVAILABLE', 'OPEN']);
  assert.equal(input.gapResponses[0].answer, 'Hos Hetzner.');
  assert.equal(input.gapResponses[1].hasReadableDocumentEvidence, true);
  assert.deepEqual(input.gapResponses[1].evidence, []);
});

test('buildImpactUpdateAnalysisAIInput: state + delta, legacy-kategorier normaliseras, berättelsen räknas inte som dokument', () => {
  const previous = normalizeImpactDashboard({
    executiveSummary: 'S',
    impactLevel: { level: 'RESPONSIBLE', rationale: 'r' },
    businessModelCompatibility: { status: 'UNCERTAIN', rationale: '', consequencesIfScaled: '' },
    risks: [{ aspectCode: 'CUS-01', category: 'CUSTOM', title: 'R', severity: 'LOW', timeHorizon: 'LONG' }],
    discussionQuestions: [{ question: 'F', whyImportant: 'v' }],
    limitations: ['L']
  });
  const input = buildImpactUpdateAnalysisAIInput({
    companyName: 'Tooly',
    phase: 'ACCELERATOR',
    previousDashboard: previous,
    materiality,
    sufficiency: normalizeImpactSufficiency({ aspectChecks: [{ code: 'OWN-ENV-01', informationStatus: 'MISSING', missingInformation: ['m'] }] }),
    narrative: '  Vi har bytt leverantör. ',
    documents: [{ originalName: 'Nytt.pdf', extractedText: 'Vi har bytt leverantör.' }, { originalName: 'Nytt2.pdf', extractedText: 'Avtal' }],
    knownEvidenceTexts: []
  });
  assert.equal(input.currentAnalysis.risks[0].category, 'SOCIAL');
  assert.match(input.currentAnalysis.limitations[1], /äldre kategorietikett/);
  assert.deepEqual(input.currentAnalysis.discussionQuestions[0], { question: 'F', whyImportant: 'v', suggestedOwnerRole: null, aspectCode: null });
  assert.equal(input.areaContext[0].informationStatus, 'MISSING');
  assert.deepEqual(input.areaContext[0].remainingUncertainties, ['u1', 'm']);
  assert.equal(input.areaContext[1].informationStatus, 'UNKNOWN');
  assert.equal(input.newEvidence.narrative, 'Vi har bytt leverantör.');
  assert.deepEqual(input.newEvidence.documents.map((d) => d.text), ['Avtal']);
  assert.equal('scores' in input.currentAnalysis, false);
});
