import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUPPORT_CHECK_RULES,
  activitiesEndDate,
  buildRevisionSnapshot,
  canTransitionSupportCheck,
  canonicalJson,
  dueDateFrom,
  evaluateSupportCheckEligibility,
  fundingEditable,
  grantedAmount,
  normalizeSupportCheckActivities,
  planSupportCheckFollowups,
  scoreSupportCheckAssessment,
  DEFAULT_SUPPORT_CHECK_CRITERIA,
  sumActivityCosts,
  summarizeSupportChecks,
  supportCheckNextStep,
  supportCheckPhase,
  validateActivitiesForSubmit,
  validateSupportCheckRuleInput,
  type SupportCheckApplicationLike,
  type SupportCheckRule,
  type SupportCheckTypeLike
} from './support-checks.ts';
import { fundingBurn, sumFundingLedger, validateFundingProjectInput, workPackageCoversDate, workPackageLabel } from './funding.ts';

const type: SupportCheckTypeLike = {
  id: 't1',
  title: 'Resecheck',
  kind: 'travel',
  requires_workshop: 'w1',
  min_irl_level: 4,
  max_amount_sek: 50000,
  requires_final_report: true,
  report_due_days: 30,
  is_excellence_activity: true,
  default_state_aid_basis: 'de_minimis'
};
const types = new Map([[type.id, type]]);

function app(over: Partial<SupportCheckApplicationLike> = {}): SupportCheckApplicationLike {
  return {
    id: 'a1',
    check_type: 't1',
    startup: 's1',
    startup_name: 'Fixkod',
    title: 'Marknadsundersökning Norden',
    status: 'submitted',
    activities: [
      { id: 'insats-1', title: 'Resa Oslo', description: 'Besöka tre kunder i Oslo och validera prissättning.', participants: 'VD', cost_sek: 20000, expert_need: '', ends_at: '2026-11-30' }
    ],
    requested_amount_sek: 20000,
    submitted_at: '2026-10-01',
    ...over
  };
}

function rules(): SupportCheckRule[] {
  return DEFAULT_SUPPORT_CHECK_RULES.map((r, i) => ({ ...r, id: `r${i + 1}` }));
}

test('normalizeSupportCheckActivities: cappar, släpper tomma rader och ger unika id:n', () => {
  const out = normalizeSupportCheckActivities([
    { id: 'x', title: ' Resa ', description: 'Beskrivning', cost_sek: '12 500', participants: 'VD', ends_at: '2026-12-01T00:00:00Z' },
    { id: 'x', title: 'Två', description: 'B', cost_sek: -5 },
    { title: '', description: '' },
    'skräp'
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Resa');
  assert.equal(out[0].cost_sek, 12500);
  assert.equal(out[0].ends_at, '2026-12-01');
  assert.equal(out[1].cost_sek, null);
  assert.notEqual(out[0].id, out[1].id);
});

test('validateActivitiesForSubmit kräver rubrik, beskrivning och kostnad', () => {
  assert.deepEqual(validateActivitiesForSubmit([]), ['Minst en insats måste beskrivas.']);
  const errs = validateActivitiesForSubmit([{ id: 'i', title: '', description: 'kort', participants: '', cost_sek: null, expert_need: '', ends_at: null }]);
  assert.equal(errs.length, 3);
  assert.deepEqual(validateActivitiesForSubmit(app().activities), []);
});

test('sumActivityCosts + activitiesEndDate', () => {
  const acts = normalizeSupportCheckActivities([
    { title: 'a', description: 'd', cost_sek: 10, ends_at: '2026-10-01' },
    { title: 'b', description: 'd', cost_sek: 5.5, ends_at: '2026-12-15' }
  ]);
  assert.equal(sumActivityCosts(acts), 15.5);
  assert.equal(activitiesEndDate(acts), '2026-12-15');
});

test('statusmaskinen: bolaget får skicka in men inte besluta; ledningen ärver staff', () => {
  assert.equal(canTransitionSupportCheck('draft', 'submitted', 'applicant'), true);
  assert.equal(canTransitionSupportCheck('submitted', 'approved', 'applicant'), false);
  assert.equal(canTransitionSupportCheck('submitted', 'approved', 'staff'), false);
  assert.equal(canTransitionSupportCheck('submitted', 'approved', 'lead'), true);
  assert.equal(canTransitionSupportCheck('submitted', 'changes_requested', 'lead'), true);
  assert.equal(canTransitionSupportCheck('changes_requested', 'submitted', 'applicant'), true);
  assert.equal(canTransitionSupportCheck('paid', 'withdrawn', 'lead'), false);
  assert.equal(canTransitionSupportCheck('approved', 'withdrawn', 'lead'), true);
  assert.equal(canTransitionSupportCheck('closed', 'submitted', 'lead'), false);
  assert.equal(fundingEditable('approved'), true);
  assert.equal(fundingEditable('paid'), false);
});

test('supportCheckPhase följer klockan och utlåtandena', () => {
  const today = '2026-10-15';
  assert.equal(supportCheckPhase(app(), type, today), 'awaiting_review');
  assert.equal(supportCheckPhase(app({ status: 'under_review', coach_statement_at: '2026-10-05' }), type, today), 'awaiting_controller');
  assert.equal(
    supportCheckPhase(app({ status: 'under_review', coach_statement_at: '2026-10-05', controller_statement_at: '2026-10-08' }), type, today),
    'awaiting_decision'
  );
  assert.equal(supportCheckPhase(app({ status: 'changes_requested', changes_due_at: '2026-10-10' }), type, today), 'changes_overdue');
  assert.equal(supportCheckPhase(app({ status: 'changes_requested', changes_due_at: '2026-10-20' }), type, today), 'changes_requested');
  assert.equal(supportCheckPhase(app({ status: 'paid', paid_at: '2026-10-01', activity_end_date: '2026-11-30' }), type, today), 'in_progress');
  assert.equal(
    supportCheckPhase(app({ status: 'paid', paid_at: '2026-10-01', activity_end_date: '2026-10-10', report_due_at: '2026-11-09' }), type, today),
    'report_due'
  );
  assert.equal(
    supportCheckPhase(app({ status: 'paid', paid_at: '2026-06-01', activity_end_date: '2026-07-10', report_due_at: '2026-08-09' }), type, today),
    'report_overdue'
  );
  assert.equal(
    supportCheckPhase(app({ status: 'paid', activity_end_date: '2026-07-10' }), { requires_final_report: false }, today),
    'in_progress'
  );
  assert.equal(supportCheckNextStep(app(), 'awaiting_review').who, 'coach');
  assert.equal(supportCheckNextStep(app(), 'changes_overdue').who, 'applicant');
  assert.equal(supportCheckNextStep(app({ funding_project: null }), 'awaiting_decision').label, 'Sätt finansiering och besluta');
});

test('grantedAmount + summarizeSupportChecks', () => {
  assert.equal(grantedAmount(app()), 0);
  assert.equal(grantedAmount(app({ status: 'approved', approved_amount_sek: 15000 })), 15000);
  assert.equal(grantedAmount(app({ status: 'paid' })), 20000);
  const s = summarizeSupportChecks(
    [
      app(),
      app({ id: 'a2', status: 'paid', paid_at: '2026-10-05', approved_amount_sek: 18000 }),
      app({ id: 'a3', status: 'changes_requested', changes_due_at: '2026-09-01' }),
      app({ id: 'a4', status: 'rejected' })
    ],
    types,
    '2026-10-15'
  );
  assert.equal(s.total, 4);
  assert.equal(s.open, 3);
  assert.equal(s.awaitingMovexum, 1);
  assert.equal(s.awaitingCompany, 2); // komplettering + pågående insats
  assert.equal(s.grantedSek, 18000);
  assert.equal(s.paidSek, 18000);
  assert.equal(s.overdue, 1);
});

test('evaluateSupportCheckEligibility: workshop, IRL, de minimis-utrymme och tak', () => {
  const checks = evaluateSupportCheckEligibility({
    type,
    workshopDone: false,
    workshopTitle: 'Internationalisering',
    irlLevel: 5,
    deMinimisHeadroomEur: 1000,
    requestedSek: 20000,
    sekPerEur: 11.3
  });
  const by = Object.fromEntries(checks.map((c) => [c.key, c.status]));
  assert.equal(by.workshop, 'fail');
  assert.equal(by.irl, 'ok');
  assert.equal(by.de_minimis, 'fail'); // 20000/11.3 ≈ 1770 EUR > 1000
  assert.equal(by.max_amount, 'ok');

  const art22 = evaluateSupportCheckEligibility({
    type,
    workshopDone: null,
    irlLevel: null,
    deMinimisHeadroomEur: null,
    requestedSek: 60000,
    sekPerEur: 11.3,
    stateAidBasis: 'art22'
  });
  const by2 = Object.fromEntries(art22.map((c) => [c.key, c.status]));
  assert.equal(by2.workshop, 'unknown');
  assert.equal(by2.irl, 'unknown');
  assert.equal(by2.de_minimis, 'n/a');
  assert.equal(by2.max_amount, 'fail');
});

test('scoreSupportCheckAssessment delar modellen med leverantörsutvärderingen', () => {
  const r = scoreSupportCheckAssessment(DEFAULT_SUPPORT_CHECK_CRITERIA, { affarsnytta: 5, genomforbarhet: 3, egen_insats: 4, kostnad: 4 });
  assert.equal(r.missing.length, 1);
  assert.ok(r.score !== null && r.score > 3.5 && r.score < 4.5);
});

test('canonicalJson + buildRevisionSnapshot ger stabil hash-bas oavsett nyckelordning', () => {
  const a = canonicalJson({ b: 1, a: [{ y: 2, x: 1 }], c: undefined });
  const b = canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 });
  assert.equal(a, b);
  const snap = buildRevisionSnapshot({ revision: 2, title: ' T ', activities: app().activities, document_ids: ['b', 'a'] });
  assert.equal(snap.title, 'T');
  assert.deepEqual(snap.document_ids, ['a', 'b']);
  assert.equal(snap.applicant_note, '');
});

test('validateSupportCheckRuleInput + dueDateFrom', () => {
  const ok = validateSupportCheckRuleInput({ name: 'x', anchor: 'paid_at', condition: 'report_missing', task_title: 't', check_type: 't1' });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.check_type, 't1');
  assert.equal(validateSupportCheckRuleInput({ name: 'x', anchor: 'nope', task_title: 't' }).ok, false);
  assert.equal(validateSupportCheckRuleInput({ name: 'x', anchor: 'paid_at', condition: 'never', task_title: 't' }).ok, false);
  assert.equal(dueDateFrom('2026-10-01', 14), '2026-10-15');
  assert.equal(dueDateFrom('bad', 14), null);
});

test('planSupportCheckFollowups: uppgifter följer statusen och auto-stängs; nycklar bär prefixet', () => {
  const plan = planSupportCheckFollowups({ applications: [app()], types, rules: rules() });
  const wantedRules = plan.wanted.map((w) => w.ruleId);
  // Inskickad utan utlåtande: "Bedöm ansökan" öppen, "Beslut väntar" öppen (beslut saknas), controller/utbetalning/rapport stängda.
  assert.ok(wantedRules.includes('r1'));
  assert.ok(wantedRules.includes('r3'));
  assert.ok(!wantedRules.includes('r2'));
  assert.ok(plan.wanted.every((w) => w.key.startsWith('check:')));
  assert.equal(plan.wanted.find((w) => w.ruleId === 'r1')?.title, 'Skriv coachutlåtande: Fixkod — Marknadsundersökning Norden');

  const afterCoach = planSupportCheckFollowups({
    applications: [app({ status: 'under_review', coach_statement_at: '2026-10-03' })],
    types,
    rules: rules()
  });
  assert.ok(afterCoach.resolved.some((r) => r.ruleId === 'r1'));
  assert.ok(afterCoach.wanted.some((w) => w.ruleId === 'r2'));

  const paid = planSupportCheckFollowups({
    applications: [app({ status: 'paid', decided_at: '2026-10-10', paid_at: '2026-10-12', activity_end_date: '2026-11-30' })],
    types,
    rules: rules()
  });
  assert.ok(paid.wanted.some((w) => w.ruleId === 'r6' && w.dueDate === '2026-12-14'));
  assert.ok(paid.resolved.some((r) => r.ruleId === 'r5'));

  const withdrawn = planSupportCheckFollowups({ applications: [app({ status: 'withdrawn' })], types, rules: rules() });
  assert.equal(withdrawn.wanted.length, 0);

  const scoped = planSupportCheckFollowups({
    applications: [app()],
    types,
    rules: [{ ...rules()[0], check_type: 'annan' }]
  });
  assert.equal(scoped.wanted.length, 0);
});

test('funding: burn, ledger och validering', () => {
  const b = fundingBurn({ budgetSek: 100000, grantedSek: 20000, paidSek: 10000, startsAt: '2026-01-01', endsAt: '2026-12-31', today: '2026-07-02' });
  assert.equal(b.remainingSek, 80000);
  assert.equal(b.pctGranted, 20);
  assert.equal(b.signal, 'behind');
  assert.equal(fundingBurn({ budgetSek: 100000, grantedSek: 120000, paidSek: 0, today: '2026-07-02' }).signal, 'over');
  assert.equal(fundingBurn({ budgetSek: null, grantedSek: 5, paidSek: 0, today: '2026-07-02' }).signal, 'none');

  const totals = sumFundingLedger(
    [
      { project: 'p', work_package: 'ap1', granted_sek: 100, paid_at: '2026-01-01' },
      { project: 'p', work_package: 'ap2', granted_sek: 50 },
      { project: 'q', work_package: 'ap1', granted_sek: 999 }
    ],
    { project: 'p' }
  );
  assert.deepEqual(totals, { grantedSek: 150, paidSek: 100, count: 2 });
  assert.equal(sumFundingLedger([{ project: 'p', work_package: 'ap1', granted_sek: 100 }], { workPackage: 'ap1' }).grantedSek, 100);

  const v = validateFundingProjectInput({ title: 'Excellens', kind: 'vinnova', budget_sek: '3 100 000', starts_at: '2026-01-01', ends_at: '2027-12-31' });
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.budget_sek, 3100000);
    assert.equal(v.value.default_state_aid_basis, 'de_minimis');
  }
  assert.equal(validateFundingProjectInput({ title: 'x', starts_at: '2027-01-01', ends_at: '2026-01-01' }).ok, false);
  assert.equal(validateFundingProjectInput({ title: 'x', default_state_aid_basis: 'nope' }).ok, false);
  assert.equal(workPackageLabel({ code: 'AP3', title: 'Internationalisering' }), 'AP3 Internationalisering');
  assert.equal(workPackageCoversDate({ starts_at: '2026-01-01', ends_at: '2026-12-31' }, '2027-01-01'), false);
  assert.equal(workPackageCoversDate({ starts_at: null, ends_at: null }, '2027-01-01'), true);
});
