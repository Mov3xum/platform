import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPACT_ASSESSMENT_STATUSES,
  IMPACT_BMC_STATUSES,
  IMPACT_COMPANY_STATUSES,
  IMPACT_GAP_SEVERITIES,
  IMPACT_GAP_STATUSES,
  IMPACT_JOB_TYPES,
  IMPACT_LEVELS,
  IMPACT_LEVEL_CRITERIA_TEXT,
  IMPACT_LEVEL_LABELS,
  IMPACT_UPLOAD_STAGES,
  applyImpactMaterialityReview,
  canDeleteImpact,
  canManageImpact,
  canReadImpact,
  createImpactAspectDisplayCodes,
  createImpactCustomAspect,
  getImpactAreaAssessmentItems,
  getImpactDashboardInformationComment,
  getImpactSufficiencyInformationComment,
  impactCompanyStatusFor,
  impactGapResponseStatus,
  impactNextStep,
  impactPhaseFor,
  impactPotentialRank,
  normalizeImpactDashboard,
  normalizeImpactMateriality,
  normalizeImpactSufficiency,
  normalizeImpactUpdateAnalysis,
  normalizeImpactUpdateDelta,
  parseImpactAssessmentVersion,
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

test('fem impactnivåer i originalets ordning med kriterietext och svenska etiketter', () => {
  assert.deepEqual([...IMPACT_LEVELS], ['RISK_EXPOSED', 'RESPONSIBLE', 'SUSTAINABILITY_DRIVEN', 'IMPACT_DRIVEN', 'SYSTEM_CHANGING_IMPACT']);
  assert.equal(IMPACT_LEVEL_LABELS.RESPONSIBLE, 'Ansvarsfullt');
  assert.equal(IMPACT_LEVEL_LABELS.SYSTEM_CHANGING_IMPACT, 'Systemförändrande');
  assert.match(IMPACT_LEVEL_CRITERIA_TEXT, /^- RISK_EXPOSED = Riskexponerad – Bolaget har betydande/);
  assert.equal(IMPACT_LEVEL_CRITERIA_TEXT.split('\n').length, 5);
  assert.deepEqual([...IMPACT_BMC_STATUSES], ['HARMFUL_OR_RISKY', 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY', 'UNCERTAIN']);
});

test('roller: personal driver, observer läser, ledning tar bort, bolagsmedlem inget', () => {
  assert.equal(canManageImpact(['coach']), true);
  assert.equal(canManageImpact(['observer']), false);
  assert.equal(canReadImpact(['observer']), true);
  assert.equal(canReadImpact(['startup_member']), false);
  assert.equal(canReadImpact(undefined), false);
  assert.equal(canDeleteImpact(['coach']), false);
  assert.equal(canDeleteImpact(['incubator_lead']), true);
});

test('plattformens fas → analysens fas', () => {
  assert.equal(impactPhaseFor('lead'), 'SCREENING');
  assert.equal(impactPhaseFor('inflode'), 'SCREENING');
  assert.equal(impactPhaseFor('boost_chamber'), 'BOOST_CHAMBER');
  assert.equal(impactPhaseFor('incubation'), 'INKUBATOR');
  assert.equal(impactPhaseFor('prescale'), 'INKUBATOR');
  assert.equal(impactPhaseFor('acceleration'), 'ACCELERATOR');
  assert.equal(impactPhaseFor('alumni'), 'ACCELERATOR');
});

test('normalizeImpactMateriality: originalets fält (styrka 1–5, drivare, säkerhet), tolererar skräp', () => {
  const m = normalizeImpactMateriality({
    companySummary: 'Bolaget …',
    selectedAspects: [
      {
        code: 'own-env-01',
        name: 'Materialeffektivitet',
        status: 'material',
        materialityStrength: 4,
        materialityDrivers: ['IMPACT', 'value chain', 'nonsens'],
        confidence: 'HIGH',
        evidence: [{ note: 'n', excerpt: 'e', documentName: 'd.pdf' }, 'bara text']
      },
      { code: '???', category: 'Social', name: 'Trygg användning', status: 'UNCERTAIN', materialityStrength: 'high', confidence: 0.2 },
      'nonsens'
    ],
    consideredButNotMaterial: [{ code: 'OWN-GOV-02', name: 'Leverantörsled', rationale: 'r' }, { code: 'CUS-01', category: 'CUSTOM', name: 'Gammalt', rationale: 'legacy' }],
    warnings: ['w', 5, null],
    assumptions: 'ett enda antagande'
  });
  assert.equal(m.selectedAspects.length, 3);
  assert.equal(m.selectedAspects[0].code, 'OWN-ENV-01');
  assert.equal(m.selectedAspects[0].category, 'ENVIRONMENT');
  assert.equal(m.selectedAspects[0].status, 'MATERIAL');
  assert.equal(m.selectedAspects[0].materialityStrength, 4);
  assert.deepEqual(m.selectedAspects[0].materialityDrivers, ['IMPACT', 'VALUE_CHAIN']);
  assert.equal(m.selectedAspects[0].confidence, 'HIGH');
  assert.deepEqual(m.selectedAspects[0].evidence[1], { documentName: null, note: 'bara text', excerpt: null });
  assert.equal(m.selectedAspects[1].code, 'OWN-SOC-02');
  assert.equal(m.selectedAspects[1].category, 'SOCIAL');
  assert.equal(m.selectedAspects[1].materialityStrength, 4);
  assert.equal(m.selectedAspects[1].confidence, 'LOW');
  assert.equal(m.selectedAspects[2].name, 'Namnlöst område');
  assert.equal(m.selectedAspects[2].materialityStrength, 3);
  assert.equal(m.consideredButNotMaterial[0].category, 'GOVERNANCE');
  assert.equal(m.consideredButNotMaterial[1].category, 'CUSTOM');
  assert.equal(m.consideredButNotMaterial[1].code, 'CUS-01');
  assert.deepEqual(m.warnings, ['w', '5']);
  assert.deepEqual(m.assumptions, ['ett enda antagande']);
});

test('normalizeImpactSufficiency: listor för vet/saknas, frågans alla fält, ready bara vid true', () => {
  const s = normalizeImpactSufficiency({
    readyForFinalAnalysis: 'true',
    overallInformationQuality: 268,
    aspectChecks: [
      {
        code: 'OWN-GOV-01',
        name: 'Ansvar',
        informationStatus: 'missing',
        whatWeKnow: ['a'],
        missingInformation: 'b',
        question: { question: 'Hur?', severity: 'required', missingInformation: 'x', whyThisMattersForFinalAssessment: 'y', exampleHelpfulEvidence: 'z' }
      },
      { code: 'OWN-SOC-01', name: 'Trygghet', question: 'Vad?', confidence: 'HIGH' },
      { code: 'OWN-ENV-01', name: 'Material', informationStatus: 'SUFFICIENT' }
    ]
  });
  assert.equal(s.readyForFinalAnalysis, false);
  assert.equal(s.overallInformationQuality, 100);
  assert.equal(s.aspectChecks[0].informationStatus, 'MISSING');
  assert.deepEqual(s.aspectChecks[0].missingInformation, ['b']);
  assert.equal(s.aspectChecks[0].question?.severity, 'REQUIRED');
  assert.equal(s.aspectChecks[0].question?.whyThisMattersForFinalAssessment, 'y');
  assert.equal(s.aspectChecks[1].question?.question, 'Vad?');
  assert.equal(s.aspectChecks[1].question?.severity, 'RECOMMENDED');
  assert.equal(s.aspectChecks[1].informationStatus, 'PARTIAL');
  assert.equal(s.aspectChecks[2].question, null);
  assert.equal(s.aspectChecks[2].confidence, 'MEDIUM');
});

test('normalizeImpactDashboard: etiketten följer koden, overall utan osäkerheter, HARMFUL_OR_RISKY, disclaimer alltid', () => {
  const d = normalizeImpactDashboard({
    executiveSummary: 'Sammanfattning',
    impactLevel: { level: 'system-changing-impact', labelSv: 'fel etikett', rationale: 'r' },
    businessModelCompatibility: { status: 'harmful_or_risky' },
    areaAssessments: {
      overall: { potentialLabel: 'fel', assessment: 'o', uncertaintyNotes: ['ska bort'] },
      social: { assessment: 'a', potentialLabel: 'p', uncertaintyNotes: ['u'] }
    },
    risks: [{ title: 'Risk', aspectCode: 'OWN-SOC-01', severity: 'extreme', timeHorizon: 'short', evidence: ['e'] }, { title: '' }],
    opportunities: [{ title: 'Chans', category: 'ENVIRONMENT', potential: 'HIGH' }],
    whatCompanyNeedsToWorkOn: [{ title: 'Gör', priority: 'LOW' }],
    discussionQuestions: [{ question: 'F?', whyImportant: 'v', suggestedOwnerRole: null, aspectCode: 'OWN-SOC-01' }],
    informationQualityComment: 'Läs som tidig bild.'
  });
  assert.equal(d.impactLevel.level, 'SYSTEM_CHANGING_IMPACT');
  assert.equal(d.impactLevel.labelSv, 'Systemförändrande');
  assert.equal(d.areaAssessments.overall.potentialLabel, 'Systemförändrande');
  assert.deepEqual(d.areaAssessments.overall.uncertaintyNotes, []);
  assert.equal(d.areaAssessments.overall.assessment, 'o');
  assert.equal(d.businessModelCompatibility.status, 'HARMFUL_OR_RISKY');
  assert.equal(d.risks.length, 1);
  assert.equal(d.risks[0].category, 'SOCIAL');
  assert.equal(d.risks[0].severity, 'MEDIUM');
  assert.equal(d.risks[0].timeHorizon, 'SHORT');
  assert.equal(d.opportunities[0].potential, 'HIGH');
  assert.equal(d.whatCompanyNeedsToWorkOn[0].priority, 'LOW');
  assert.deepEqual(d.discussionQuestions[0], { question: 'F?', whyImportant: 'v', aspectCode: 'OWN-SOC-01' });
  assert.equal(d.areaAssessments.social.potentialLabel, 'p');
  assert.equal(d.informationQualityComment, 'Läs som tidig bild.');
  assert.match(d.disclaimer, /Genererat av AI/);
  assert.equal(d.scores, undefined);
});

test('normalizeImpactDashboard: äldre analys med poäng → områdesbedömningar och informationskommentar (originalets legacy-regler)', () => {
  const d = normalizeImpactDashboard({
    executiveSummary: 'S',
    impactLevel: { level: 'RESPONSIBLE', labelSv: 'Ansvarsfullt', rationale: 'Därför.' },
    businessModelCompatibility: { status: 'INCOMPATIBLE', rationale: '', consequencesIfScaled: '' },
    scores: { overall: 55, environment: 30, social: 65, governance: 85 },
    scoreRationale: { overall: 'o', environment: '', social: 's', governance: 'g' },
    informationQualityScore: 40,
    informationQualityRationale: 'En lång första mening som är längre än hundratio tecken och därför inte ska användas som kommentar i gränssnittet alls. Andra meningen.',
    limitations: ['L1', 'L2', 'L3'],
    risks: [],
    opportunities: [],
    whatCompanyNeedsToWorkOn: [],
    discussionQuestions: [],
    greenwashingRisks: [],
    assumptions: []
  });
  assert.equal(d.businessModelCompatibility.status, 'HARMFUL_OR_RISKY');
  assert.equal(d.areaAssessments.overall.assessment, 'Därför.');
  assert.equal(d.areaAssessments.environment.potentialLabel, 'Osäker potential');
  assert.match(d.areaAssessments.environment.assessment, /saknar separat miljötext/);
  assert.equal(d.areaAssessments.social.potentialLabel, 'Ansvarsfull → Hållbarhetsdrivande');
  assert.equal(d.areaAssessments.social.assessment, 's');
  assert.equal(d.areaAssessments.governance.potentialLabel, 'Impactdrivande');
  assert.deepEqual(d.areaAssessments.governance.uncertaintyNotes, ['L1', 'L2']);
  assert.equal(d.informationQualityComment, 'Begränsat underlag.');
  assert.equal(d.informationQualityScore, 40);
  assert.deepEqual(d.scores, { overall: 55, environment: 30, social: 65, governance: 85 });
  assert.equal(getImpactDashboardInformationComment(d), 'Begränsat underlag.');
});

test('normalizeImpactUpdateDelta/normalizeImpactUpdateAnalysis + parseImpactModelJson', () => {
  const raw = parseImpactModelJson(
    'Här är svaret:\n```json\n{"deltaSummary":{"newRisks":["a"],"reducedRisks":[],"whatChangedSinceLastAssessment":["b"],"changedImpactLevel":null,"changedAreaAssessments":[{"category":"social","previousPotential":"x","newPotential":"y","reason":"z"},"fri text"]},"updatedDashboard":{"impactLevel":{"level":"IMPACT_DRIVEN"}}}\n```'
  );
  const u = normalizeImpactUpdateAnalysis(raw);
  assert.deepEqual(u.deltaSummary.newRisks, ['a']);
  assert.deepEqual(u.deltaSummary.whatChangedSinceLastAssessment, ['b']);
  assert.equal(u.deltaSummary.changedImpactLevel, undefined);
  assert.deepEqual(u.deltaSummary.changedAreaAssessments, [
    { category: 'SOCIAL', previousPotential: 'x', newPotential: 'y', reason: 'z' },
    { category: 'OVERALL', previousPotential: '', newPotential: '', reason: 'fri text' }
  ]);
  assert.equal(u.updatedDashboard.impactLevel.labelSv, 'Impactdrivande');
  assert.deepEqual(normalizeImpactUpdateDelta({ newOpportunities: ['o'] }).newOpportunities, ['o']);
  assert.equal(parseImpactModelJson('inget json här'), null);
  assert.equal(parseImpactModelJson('{"trasig": '), null);
});

test('applyImpactMaterialityReview: beslut, kommentarer, uppflyttning — exakt som originalet', () => {
  const m = normalizeImpactMateriality({
    selectedAspects: [
      { code: 'OWN-SOC-01', name: 'A', category: 'SOCIAL', status: 'MATERIAL', rationale: 'ra', uncertaintyNotes: ['u0'] },
      { code: 'OWN-GOV-01', name: 'B', category: 'GOVERNANCE', status: 'UNCERTAIN', rationale: 'rb' }
    ],
    consideredButNotMaterial: [{ code: 'OWN-ENV-01', name: 'C', category: 'ENVIRONMENT', rationale: 'ej' }]
  });
  const { materiality, changes } = applyImpactMaterialityReview(m, {
    decisions: [
      { aspectCode: 'OWN-SOC-01', status: 'NOT_MATERIAL', comment: 'Inte relevant i fasen' },
      { aspectCode: 'OWN-GOV-01', status: 'MATERIAL', comment: '' }
    ],
    promotions: [{ aspectCode: 'OWN-ENV-01', comment: 'Hosting väger tungt' }]
  });
  assert.deepEqual(changes, [
    { aspectCode: 'OWN-SOC-01', originalStatus: 'MATERIAL', newStatus: 'NOT_MATERIAL', comment: 'Inte relevant i fasen' },
    { aspectCode: 'OWN-GOV-01', originalStatus: 'UNCERTAIN', newStatus: 'MATERIAL', comment: '' },
    { aspectCode: 'OWN-ENV-01', originalStatus: 'NOT_MATERIAL', newStatus: 'MATERIAL', comment: 'Hosting väger tungt' }
  ]);
  assert.deepEqual(materiality.selectedAspects.map((a) => [a.code, a.status]), [['OWN-GOV-01', 'MATERIAL'], ['OWN-ENV-01', 'MATERIAL']]);
  const promoted = materiality.selectedAspects[1];
  assert.equal(promoted.confidence, 'LOW');
  assert.deepEqual(promoted.materialityDrivers, ['IMPACT']);
  assert.match(promoted.rationale, /Användarens motivering: Hosting väger tungt/);
  assert.equal(materiality.consideredButNotMaterial.length, 1);
  assert.equal(materiality.consideredButNotMaterial[0].code, 'OWN-SOC-01');
  assert.match(materiality.consideredButNotMaterial[0].rationale, /Användarkommentar: Inte relevant i fasen/);

  // Bara en kommentar (status oförändrad) bokförs också som ändring och hamnar i uncertaintyNotes.
  const second = applyImpactMaterialityReview(m, { decisions: [{ aspectCode: 'OWN-SOC-01', status: 'MATERIAL', comment: 'Bra formulerat' }], promotions: [] });
  assert.equal(second.changes.length, 1);
  assert.deepEqual(second.materiality.selectedAspects[0].uncertaintyNotes, ['u0', 'Användarkommentar: Bra formulerat']);
});

test('createImpactCustomAspect: nästa lediga OWN-kod per kategori', () => {
  const m = normalizeImpactMateriality({
    selectedAspects: [{ code: 'OWN-GOV-01', name: 'A', category: 'GOVERNANCE' }],
    consideredButNotMaterial: [{ code: 'OWN-GOV-03', name: 'B', category: 'GOVERNANCE', rationale: 'r' }]
  });
  const custom = createImpactCustomAspect(m, { name: 'Dataansvar', category: 'GOVERNANCE', underlying: 'avtal, loggning,' });
  assert.equal(custom.code, 'OWN-GOV-04');
  assert.deepEqual(custom.underlyingAspects, ['avtal', 'loggning']);
  assert.equal(custom.status, 'MATERIAL');
  assert.equal(createImpactCustomAspect(m, { name: 'Energi', category: 'nonsens' }).code, 'OWN-GOV-04');
  assert.equal(createImpactCustomAspect(m, { name: 'Energi', category: 'ENVIRONMENT' }).code, 'OWN-ENV-01');
});

test('visningskoder per kategori, områdeskort och informationsläge', () => {
  assert.deepEqual(
    createImpactAspectDisplayCodes([{ category: 'SOCIAL' }, { category: 'ENVIRONMENT' }, { category: 'SOCIAL' }, { category: 'CUSTOM' }]),
    ['SOC-01', 'ENV-01', 'SOC-02', 'OWN-01']
  );
  const items = getImpactAreaAssessmentItems(null);
  assert.equal(items.length, 4);
  assert.equal(items[0].potentialLabel, 'Ej bedömt');
  const s = normalizeImpactSufficiency({
    readyForFinalAnalysis: true,
    aspectChecks: [{ code: 'OWN-ENV-01', informationStatus: 'SUFFICIENT' }, { code: 'OWN-SOC-01', informationStatus: 'PARTIAL' }, { code: 'OWN-GOV-01', informationStatus: 'MISSING' }]
  });
  assert.match(
    getImpactSufficiencyInformationComment(s),
    /räcker för en första coachande bedömning.*1 område har tillräcklig information, 1 område är delvis belyst och 1 område saknar viktig information/
  );
  assert.equal(impactPotentialRank('Systemförändrande'), 5);
  assert.equal(impactPotentialRank('Ansvarsfull → Hållbarhetsdrivande'), 3);
});

test('statusmaskinen, gap-status och versionsparametern', () => {
  assert.equal(impactCompanyStatusFor('materiality_review'), 'materiality_review');
  assert.equal(impactCompanyStatusFor('final_pending'), 'info_collection');
  assert.equal(impactCompanyStatusFor('complete'), 'analyzed');
  assert.equal(impactNextStep('materiality_pending', 0), 'run_materiality');
  assert.equal(impactNextStep('needs_more_info', 2), 'answer_gaps');
  assert.equal(impactNextStep('needs_more_info', 0), 'run_final');
  assert.equal(impactNextStep('complete', 0), 'done');
  assert.equal(impactGapResponseStatus('NOT_AVAILABLE', 'svar', false), 'not_available');
  assert.equal(impactGapResponseStatus('open', null, true), 'answered');
  assert.equal(impactGapResponseStatus('answered', null, false), 'open');
  assert.equal(parseImpactAssessmentVersion('3'), 3);
  assert.equal(parseImpactAssessmentVersion('0'), null);
  assert.equal(parseImpactAssessmentVersion('abc'), null);
});
