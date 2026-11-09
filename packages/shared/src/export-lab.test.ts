import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPORT_ASSESSMENT_STATUSES,
  EXPORT_COMPANY_STATUSES,
  EXPORT_DIMENSIONS,
  EXPORT_FRAMEWORKS,
  EXPORT_IRL_GATES,
  EXPORT_JOB_TYPES,
  EXPORT_READINESS_LEVELS,
  EXPORT_READINESS_LEVEL_CRITERIA_TEXT,
  EXPORT_REGULATORY_DOMAINS,
  EXPORT_UPLOAD_STAGES,
  applyExportMarketReview,
  canDeleteExportLab,
  canViewExportCompany,
  canWorkOnExportCompany,
  canManageExportLab,
  canReadExportLab,
  createExportCustomMarket,
  evaluateExportIrlGates,
  exportCompanyStatusFor,
  exportGapResponseStatus,
  exportNextStep,
  exportPhaseFor,
  getExportSufficiencyComment,
  normalizeExportPlan,
  normalizeExportProfile,
  normalizeExportSufficiency,
  normalizeExportUpdateAnalysis,
  parseExportAssessmentVersion,
  parseExportModelJson,
  suggestExportReadinessFromIrl
} from './export-lab';
import { createAnalysisLease, isAnalysisLease, isStaleAnalysisLease, readAnalysisLease } from './analysis-lease';
import { buildExportIrlContext, buildExportPlanAIInput, buildExportProfileAIInput, buildExportUpdateAIInput, parseDesiredMarkets } from './export-lab-inputs';
import { EXPORT_OUTPUT_FORMATS, EXPORT_PROMPT_VERSION, buildExportStepInstructions, buildExportSystemPrompt } from './export-lab-prompts';
import { mockExportPlan, mockExportProfile, mockExportSufficiency, mockExportUpdate } from './export-lab-mock';

test('vokabulären speglar migration 1700000210', () => {
  assert.deepEqual([...EXPORT_COMPANY_STATUSES], ['draft', 'market_review', 'info_collection', 'needs_more_info', 'planned']);
  assert.deepEqual([...EXPORT_ASSESSMENT_STATUSES], ['profile_pending', 'market_review', 'info_pending', 'needs_more_info', 'plan_pending', 'complete', 'failed']);
  assert.deepEqual([...EXPORT_UPLOAD_STAGES], ['innovation_description', 'full_information', 'gap_response', 'update']);
  assert.deepEqual([...EXPORT_JOB_TYPES], ['profile', 'sufficiency', 'plan', 'update_plan']);
  assert.deepEqual([...EXPORT_READINESS_LEVELS], ['EXPLORE', 'PREPARE', 'PILOT', 'ESTABLISH', 'SCALE']);
  assert.equal(EXPORT_READINESS_LEVEL_CRITERIA_TEXT.split('\n').length, 5);
  assert.equal(EXPORT_DIMENSIONS.length, 6);
});

test('forskningsramverken och regelverkskatalogen är kompletta och unika', () => {
  const keys = EXPORT_FRAMEWORKS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['uppsala', 'born_global', 'cage', 'hofstede_meyer', 'entry_mode', 'market_screening', 'effectuation', 'export_readiness', 'kth_irl']) assert.ok(keys.includes(k), k);
  for (const f of EXPORT_FRAMEWORKS) assert.ok(f.source.length > 5 && f.usedFor.length > 20, f.key);
  const reg = EXPORT_REGULATORY_DOMAINS.map((d) => d.key);
  assert.equal(new Set(reg).size, reg.length);
  assert.ok(reg.includes('ce_marking') && reg.includes('gdpr_data') && reg.includes('export_control'));
});

test('roller: personal driver, observer läser, ledning tar bort', () => {
  assert.equal(canManageExportLab(['coach']), true);
  assert.equal(canManageExportLab(['observer']), false);
  assert.equal(canReadExportLab(['observer']), true);
  assert.equal(canReadExportLab(['startup_member']), false);
  assert.equal(canDeleteExportLab(['coach']), false);
  assert.equal(canDeleteExportLab(['incubator_lead']), true);
  const member = { roles: ['startup_member'] as const, linkedStartups: ['s1'] };
  assert.equal(canWorkOnExportCompany(member, 's1'), true);
  assert.equal(canWorkOnExportCompany(member, 's2'), false);
  assert.equal(canViewExportCompany(member, 's1'), true);
  assert.equal(canViewExportCompany({ roles: ['observer'] }, 's1'), true);
  assert.equal(canWorkOnExportCompany({ roles: ['observer'] }, 's1'), false);
  assert.equal(exportPhaseFor('incubation'), 'INKUBATOR');
  assert.equal(exportPhaseFor('lead'), 'SCREENING');
});

test('IRL-grindar: null utan bedömning, met/ej met med nivåer; föreslagen nivå följer svagaste bärande axel', () => {
  const none = evaluateExportIrlGates(null);
  assert.equal(none.length, EXPORT_IRL_GATES.length);
  assert.ok(none.every((g) => g.met === null && g.level === null));
  const gates = evaluateExportIrlGates({ crl: 6, trl: 5, brl: 5, tmrl: 4, frl: 2, iprl: 4 });
  assert.equal(gates.find((g) => g.axis === 'crl')?.met, true);
  assert.equal(gates.find((g) => g.axis === 'trl')?.met, false);
  assert.equal(gates.find((g) => g.axis === 'frl')?.met, false);
  assert.equal(suggestExportReadinessFromIrl(null), null);
  assert.equal(suggestExportReadinessFromIrl({ crl: 2, brl: 2, trl: 4 }), 'EXPLORE');
  assert.equal(suggestExportReadinessFromIrl({ crl: 5, brl: 5, trl: 6, tmrl: 5, frl: 4 }), 'PREPARE');
  assert.equal(suggestExportReadinessFromIrl({ crl: 6, brl: 6, trl: 7, tmrl: 5, frl: 5 }), 'PILOT');
  // Svagt team/finansiering dämpar även höga kärnaxlar.
  assert.equal(suggestExportReadinessFromIrl({ crl: 8, brl: 8, trl: 8, tmrl: 2, frl: 2 }), 'PREPARE');
  assert.equal(suggestExportReadinessFromIrl({ crl: 9, brl: 9, trl: 9, tmrl: 8, frl: 8 }), 'SCALE');
});

test('normalizeExportProfile: tolererar skräp, fyller alla sex dimensioner, filtrerar okända regelverk, numrerar marknader', () => {
  const p = normalizeExportProfile({
    companySummary: 'S',
    pathway: 'Nätverksdriven',
    readinessLevel: { level: 'pilot' },
    readinessDimensions: [{ key: 'offer', status: 'ready', irlAxes: ['trl', 'xyz'] }, { key: 'nonsense' }],
    candidateMarkets: [
      { code: 'X', country: 'Norge', priority: 'primary', cage: { cultural: 'low', administrative: { distance: 'HIGH', note: 'n' } }, regulatoryDomains: ['gdpr_data', 'made_up'], entryModeHint: 'direct export' },
      { country: 'Tyskland' }
    ],
    regulatoryDomains: [{ key: 'vat_tax', relevance: 'high', why: 'w' }, { key: 'nope' }, 'ce_marking'],
    assumptions: 'ett antagande'
  });
  assert.equal(p.pathway.code, 'NETWORK_LED');
  assert.equal(p.pathway.labelSv, 'Nätverksdriven');
  assert.equal(p.readinessLevel.level, 'PILOT');
  assert.equal(p.readinessLevel.labelSv, 'Pilotexport');
  assert.equal(p.readinessDimensions.length, 6);
  assert.deepEqual(p.readinessDimensions[0], { key: 'OFFER', status: 'READY', rationale: '', irlAxes: ['trl'], evidence: [] });
  assert.equal(p.readinessDimensions.find((d) => d.key === 'TEAM')?.status, 'PARTIAL');
  assert.equal(p.candidateMarkets[0].code, 'MKT-01');
  assert.equal(p.candidateMarkets[0].priority, 'PRIMARY');
  assert.equal(p.candidateMarkets[0].cage.cultural.distance, 'LOW');
  assert.equal(p.candidateMarkets[0].cage.administrative.distance, 'HIGH');
  assert.equal(p.candidateMarkets[0].cage.geographic.distance, 'MEDIUM');
  assert.deepEqual(p.candidateMarkets[0].regulatoryDomains, ['gdpr_data']);
  assert.equal(p.candidateMarkets[0].entryModeHint, 'DIRECT_EXPORT');
  assert.equal(p.candidateMarkets[1].code, 'MKT-02');
  assert.equal(p.candidateMarkets[1].priority, 'SECONDARY');
  assert.deepEqual(p.regulatoryDomains.map((r) => [r.key, r.relevance]), [['vat_tax', 'HIGH'], ['ce_marking', 'MEDIUM']]);
  assert.equal(p.regulatoryDomains[0].name, 'Moms & skatt');
  assert.deepEqual(p.assumptions, ['ett antagande']);
});

test('normalizeExportSufficiency: dimension vs marknad känns igen på koden', () => {
  const s = normalizeExportSufficiency({
    readyForPlan: true,
    overallInformationQuality: '61',
    checks: [
      { code: 'MKT-01', name: 'Norge', informationStatus: 'partial', question: { question: 'Q?', severity: 'required' } },
      { code: 'finance', informationStatus: 'missing', question: 'Hur mycket kapital?' },
      { code: 'weird', kind: 'MARKET' }
    ]
  });
  assert.equal(s.overallInformationQuality, 61);
  assert.equal(s.checks[0].kind, 'MARKET');
  assert.equal(s.checks[0].question?.severity, 'REQUIRED');
  assert.equal(s.checks[1].kind, 'DIMENSION');
  assert.equal(s.checks[1].code, 'FINANCE');
  assert.equal(s.checks[1].name, 'Finansiering & uthållighet');
  assert.equal(s.checks[1].question?.question, 'Hur mycket kapital?');
  assert.equal(s.checks[2].code, 'MKT-03');
  assert.match(getExportSufficiencyComment(s), /räcker för en första exportplan/);
});

test('normalizeExportPlan: inträdesform får etikett, okända regelverk blir "other", disclaimer faller tillbaka', () => {
  const plan = normalizeExportPlan({
    executiveSummary: 'E',
    internationalStrategy: { pathway: { code: 'BORN_GLOBAL' }, readinessLevel: 'Etablerar' },
    marketPlans: [
      {
        code: 'MKT-01',
        country: 'Norge',
        priority: 'PRIMARY',
        entryMode: { mode: 'licensing', rationale: 'r' },
        regulatory: [{ key: 'gdpr_data', requirement: 'x' }, { key: 'custom-thing', name: 'Lokal regel', actionBeforeEntry: 'y' }, { key: 'ce_marking' }],
        culturalPlaybook: [{ dimension: 'Tid', comparedToSweden: 'very different', implication: 'i' }]
      }
    ],
    firstExportPlan: { phases: [{ name: 'Förbered', actions: [{ title: 'A', irlAxis: 'FRL', marketCode: 'mkt-01' }, { title: '' }] }], kpis: [{ name: 'K' }] },
    readinessGaps: [{ dimension: 'finance', gap: 'g', irlAxis: 'frl' }],
    risks: [{ title: 'R', severity: 'high', timeHorizon: 'short' }]
  });
  assert.equal(plan.internationalStrategy.pathway.labelSv, 'Born global');
  assert.equal(plan.internationalStrategy.readinessLevel.level, 'ESTABLISH');
  assert.equal(plan.marketPlans[0].entryMode.labelSv, 'Licensiering');
  assert.deepEqual(plan.marketPlans[0].regulatory.map((r) => [r.key, r.name]), [['gdpr_data', 'Dataskydd & dataöverföring'], ['other', 'Lokal regel']]);
  assert.equal(plan.marketPlans[0].culturalPlaybook[0].comparedToSweden, 'VERY_DIFFERENT');
  assert.equal(plan.firstExportPlan.horizon, '12 månader');
  assert.equal(plan.firstExportPlan.phases[0].actions.length, 1);
  assert.equal(plan.firstExportPlan.phases[0].actions[0].irlAxis, 'frl');
  assert.equal(plan.firstExportPlan.phases[0].actions[0].marketCode, 'MKT-01');
  assert.equal(plan.readinessGaps[0].dimension, 'FINANCE');
  assert.equal(plan.risks[0].severity, 'HIGH');
  assert.match(plan.disclaimer, /inte juridisk rådgivning/);
  const upd = normalizeExportUpdateAnalysis({ updatedPlan: { executiveSummary: 'U' }, deltaSummary: { marketChanges: ['x'], changedReadinessLevel: 'PILOT' } });
  assert.equal(upd.updatedPlan.executiveSummary, 'U');
  assert.deepEqual(upd.deltaSummary.marketChanges, ['x']);
  assert.equal(upd.deltaSummary.changedReadinessLevel, 'PILOT');
  assert.deepEqual(parseExportModelJson('text ```json {"a":1} ```'), { a: 1 });
  assert.equal(parseExportModelJson('nope'), null);
});

test('applyExportMarketReview: uteslut, lyft, egen marknad, sortering och ändringslogg', () => {
  const profile = normalizeExportProfile({
    candidateMarkets: [
      { code: 'MKT-01', country: 'Norge', priority: 'PRIMARY', rationale: 'a' },
      { code: 'MKT-02', country: 'Tyskland', priority: 'SECONDARY', rationale: 'b' }
    ],
    consideredButNotPrioritized: [{ code: 'MKT-50', country: 'USA', rationale: 'för långt' }]
  });
  const { profile: next, changes } = applyExportMarketReview(profile, {
    decisions: [
      { code: 'MKT-01', priority: 'excluded', comment: 'ingen kontakt' },
      { code: 'MKT-02', priority: 'PRIMARY' }
    ],
    promotions: [{ code: 'MKT-50', comment: 'investerare där' }],
    customMarket: { country: 'Danmark', comment: 'kund frågar' }
  });
  assert.deepEqual(
    next.candidateMarkets.map((m) => [m.code, m.country, m.priority]),
    [
      ['MKT-02', 'Tyskland', 'PRIMARY'],
      ['MKT-50', 'USA', 'SECONDARY'],
      ['MKT-03', 'Danmark', 'SECONDARY']
    ]
  );
  assert.equal(next.candidateMarkets[1].addedByUser, true);
  assert.match(next.candidateMarkets[2].rationale, /kund frågar/);
  assert.equal(next.consideredButNotPrioritized.length, 1);
  assert.equal(next.consideredButNotPrioritized[0].code, 'MKT-01');
  assert.match(next.consideredButNotPrioritized[0].rationale, /Användarkommentar: ingen kontakt/);
  assert.deepEqual(
    changes.map((c) => [c.code, c.originalPriority, c.newPriority]),
    [
      ['MKT-01', 'PRIMARY', 'EXCLUDED'],
      ['MKT-02', 'SECONDARY', 'PRIMARY'],
      ['MKT-50', 'EXCLUDED', 'SECONDARY'],
      ['MKT-03', 'EXCLUDED', 'SECONDARY']
    ]
  );
  const custom = createExportCustomMarket(next, { country: 'Finland' });
  assert.equal(custom.code, 'MKT-04');
});

test('statusmaskin och hjälpare', () => {
  assert.equal(exportCompanyStatusFor('profile_pending'), 'draft');
  assert.equal(exportCompanyStatusFor('plan_pending'), 'info_collection');
  assert.equal(exportCompanyStatusFor('complete'), 'planned');
  assert.equal(exportNextStep('needs_more_info', 2), 'answer_gaps');
  assert.equal(exportNextStep('needs_more_info', 0), 'run_plan');
  assert.equal(exportNextStep('failed', 0), 'retry');
  assert.equal(parseExportAssessmentVersion('3'), 3);
  assert.equal(parseExportAssessmentVersion('03'), null);
  assert.equal(exportGapResponseStatus('open', null, true), 'answered');
  assert.equal(exportGapResponseStatus('not_available', 'svar', false), 'not_available');
});

test('generiskt lease: skapa, läsa, stale med minsta livslängd', () => {
  const lease = createAnalysisLease('profile', 1000, 'tok');
  assert.equal(lease, 'analysis-lease:profile:1000:tok');
  assert.deepEqual(readAnalysisLease(lease), { step: 'profile', startedAt: 1000, token: 'tok' });
  assert.equal(isAnalysisLease(lease, 'profile'), true);
  assert.equal(isAnalysisLease(lease, 'plan'), false);
  assert.equal(isStaleAnalysisLease(lease, 'profile', 10_000, 1000 + 300_000), false);
  assert.equal(isStaleAnalysisLease(lease, 'profile', 10_000, 1000 + 330_001), true);
  assert.throws(() => createAnalysisLease('Bad Step'));
  assert.equal(readAnalysisLease('sha256hash'), null);
});

test('AI-underlag: IRL-kontext, önskade marknader och gap-svar', () => {
  assert.deepEqual(parseDesiredMarkets('Norge, Tyskland; Norge\nUSA'), ['Norge', 'Tyskland', 'USA']);
  const ctx = buildExportIrlContext({ profile: { crl: 5, trl: 6, brl: 5, tmrl: 4, frl: 4, iprl: 4 }, axisNotes: { crl: ' kundtester ' }, assessedAt: '2026-10-01' });
  assert.equal(ctx.assessed, true);
  assert.equal(ctx.suggestedLevel, 'PREPARE');
  assert.equal(ctx.axisNotes.crl, 'kundtester');
  assert.ok(ctx.gates.every((g) => g.met === true));
  const none = buildExportIrlContext(null);
  assert.equal(none.assessed, false);
  assert.equal(none.suggestedLevel, null);

  const input = buildExportProfileAIInput({
    name: ' Bolag AB ',
    phase: 'INKUBATOR',
    industry: 'Medtech',
    ambitionText: 'Vi vill till Norge.\r\n',
    desiredMarkets: 'Norge',
    irl: null,
    documents: [{ originalName: 'Pitch.pdf', extractedText: 'Vi vill till Norge.' }, { originalName: 'Plan.pdf', extractedText: 'Mer text' }]
  });
  assert.equal(input.company.name, 'Bolag AB');
  assert.deepEqual(input.company.desiredMarkets, ['Norge']);
  assert.deepEqual(input.initialEvidence.map((e) => e.sourceLabel), ['Dokument: Plan.pdf']);

  const profile = normalizeExportProfile(mockExportProfile(input));
  const sufficiency = normalizeExportSufficiency(mockExportSufficiency({ phase: 'INKUBATOR', irl: none, profile, newEvidence: [] }));
  const planInput = buildExportPlanAIInput({
    company: { name: 'Bolag AB', phase: 'INKUBATOR', industry: 'Medtech', city: '', website: '' },
    irl: null,
    profile,
    sufficiency,
    gapResponses: [
      { code: 'MKT-01', question: 'Q', status: 'open', answerText: 'Svar', documents: [] },
      { code: 'FINANCE', question: 'Q2', status: 'not_available', answerText: null, documents: [{ originalName: 'B', extractedText: 'budget' }] }
    ]
  });
  assert.equal(planInput.gapResponses[0].status, 'ANSWERED');
  assert.equal(planInput.gapResponses[1].status, 'NOT_AVAILABLE');
  assert.equal(planInput.gapResponses[1].hasReadableDocumentEvidence, true);
  const plan = normalizeExportPlan(mockExportPlan(planInput));
  assert.ok(plan.marketPlans.length >= 1);
  assert.equal(plan.marketPlans[0].entryMode.labelSv.length > 0, true);
  const upd = normalizeExportUpdateAnalysis(
    mockExportUpdate(buildExportUpdateAIInput({ companyName: 'Bolag AB', phase: 'INKUBATOR', industry: 'Medtech', irl: null, previousPlan: plan, profile, sufficiency, narrative: 'Nytt', documents: [] }))
  );
  assert.match(upd.updatedPlan.executiveSummary, /Uppdaterad/);
});

test('promptarna namnger forskningen, nivåerna och IRL-grindarna', () => {
  assert.match(EXPORT_PROMPT_VERSION, /^2026-11-05-v1/);
  const profile = buildExportSystemPrompt('profile');
  for (const s of ['Uppsala-modellen', 'Born Global', 'CAGE', 'Hofstede', 'Ghemawat', 'Sarasvathy', 'KTH Innovation Readiness Level', 'CRL ≥ 5', 'OUTPUTFORMAT', '"candidateMarkets"']) {
    assert.match(profile, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), s);
  }
  assert.doesNotMatch(buildExportStepInstructions('profile'), /FRÅGEREGLER/);
  for (const step of ['sufficiency', 'plan', 'update'] as const) assert.match(buildExportStepInstructions(step), /FRÅGEREGLER/);
  assert.match(EXPORT_OUTPUT_FORMATS.plan, /"culturalPlaybook"/);
  assert.match(EXPORT_OUTPUT_FORMATS.plan, /"firstExportPlan"/);
  assert.match(EXPORT_OUTPUT_FORMATS.update, /"deltaSummary"/);
  for (const d of EXPORT_REGULATORY_DOMAINS) assert.match(profile, new RegExp(`- ${d.key}:`));
});
