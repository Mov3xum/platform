import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CALLOFF_TEMPLATE,
  DEFAULT_PROCUREMENT_CRITERIA,
  DEFAULT_PROCUREMENT_RULES,
  normalizeCalloffTemplate,
  parseProcurementDraft,
  addMonths,
  aggregateProcurementScore,
  calloffAlerts,
  calloffPhase,
  defaultCalloffDates,
  diffProcurementFollowups,
  normalizeProcurementCriteria,
  planProcurementFollowups,
  scoreProcurementEvaluation,
  summarizeProcurement,
  validateProcurementRuleInput,
  type ProcurementCalloffLike,
  type ProcurementLike,
  type ProcurementRule
} from './procurement.ts';

const procurement: ProcurementLike = {
  id: 'p1',
  title: 'AI-stött utvecklingsstöd',
  supplier: 'Leverantör AB',
  status: 'active',
  tender_deadline: '2026-05-15',
  contract_start: '2026-06-01',
  contract_end: '2027-05-31',
  is_excellence_activity: true
};

const calloff: ProcurementCalloffLike = {
  id: 'c1',
  procurement: 'p1',
  startup: 's1',
  startup_name: 'Fixkod',
  title: 'Grundpaket Fixkod',
  status: 'active',
  started_at: '2026-09-01',
  ends_at: '2026-12-01',
  milestone_1_due: '2026-10-27',
  milestone_2_due: '2026-12-01'
};

function rules(overrides: Partial<ProcurementRule>[] = []): ProcurementRule[] {
  const base = DEFAULT_PROCUREMENT_RULES.map((r, i) => ({ ...r, id: `r${i + 1}` }));
  for (const o of overrides) {
    const idx = base.findIndex((r) => r.id === o.id);
    if (idx >= 0) base[idx] = { ...base[idx], ...o };
  }
  return base;
}

test('defaultCalloffDates: M1 = 8 veckor, slut/M2 = 3 månader efter start', () => {
  const d = defaultCalloffDates('2026-09-01');
  assert.equal(d.milestone_1_due, '2026-10-27');
  assert.equal(d.milestone_2_due, '2026-12-01');
  assert.equal(d.ends_at, '2026-12-01');
  assert.deepEqual(defaultCalloffDates(null), { milestone_1_due: null, milestone_2_due: null, ends_at: null });
});

test('addMonths klampar mot månadens sista dag', () => {
  const d = addMonths(new Date(2026, 0, 31), 1);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 28);
});

test('planProcurementFollowups: avropsregler ankras på avropets datum och fylls i med bolag/leverantör', () => {
  const plan = planProcurementFollowups({
    procurement,
    calloffs: [calloff],
    rules: rules(),
    today: '2026-09-23'
  });
  const m1 = plan.wanted.find((w) => w.key === 'r1:c1:0');
  assert.ok(m1, 'avstämning inför M1 finns');
  assert.equal(m1.dueDate, '2026-10-13');
  assert.equal(m1.startupId, 's1');
  assert.equal(m1.calloffId, 'c1');
  assert.match(m1.title, /Fixkod/);
  assert.match(m1.title, /Grundpaket Fixkod/);
  const report = plan.wanted.find((w) => w.key === 'r4:c1:0');
  assert.ok(report);
  assert.equal(report.dueDate, '2026-12-08');
  assert.match(report.title, /Leverantör AB/);
});

test('planProcurementFollowups: kvartalsregel löper från avtalsstart+90 till avtalsslut', () => {
  const plan = planProcurementFollowups({
    procurement,
    calloffs: [],
    rules: rules(),
    today: '2026-09-23'
  });
  const quarterly = plan.wanted.filter((w) => w.ruleId === 'r6');
  assert.deepEqual(
    quarterly.map((q) => q.dueDate),
    ['2026-08-30', '2026-11-30', '2027-02-28', '2027-05-30']
  );
  assert.equal(quarterly[0].calloffId, null);
  assert.equal(quarterly[0].startupId, null);
  const extension = plan.wanted.find((w) => w.ruleId === 'r7');
  assert.equal(extension?.dueDate, '2027-03-02');
});

test('planProcurementFollowups: villkor som upphört hamnar i resolved, tilldelad upphandling stänger anbudsregeln', () => {
  const approved = { ...calloff, milestone_1_approved_at: '2026-10-20' };
  const plan = planProcurementFollowups({
    procurement,
    calloffs: [approved],
    rules: rules(),
    today: '2026-10-21'
  });
  assert.ok(plan.resolved.some((r) => r.key === 'r1:c1:0'), 'M1-avstämningen är löst');
  assert.ok(plan.resolved.some((r) => r.key === 'r2:c1:0'), 'M1-försenad är löst');
  assert.ok(plan.wanted.some((w) => w.key === 'r3:c1:0'), 'M2-avstämningen är kvar');
  // status=active ⇒ upphandlingen är tilldelad ⇒ anbudsutvärderingen är löst
  assert.ok(plan.resolved.some((r) => r.ruleId === 'r8'));
  const tender = planProcurementFollowups({
    procurement: { ...procurement, status: 'tender_open' },
    calloffs: [],
    rules: rules(),
    today: '2026-05-01'
  });
  assert.equal(tender.wanted.find((w) => w.ruleId === 'r8')?.dueDate, '2026-05-16');
});

test('planProcurementFollowups: inaktiva regler, hävda avrop och saknade ankare ger inget', () => {
  const plan = planProcurementFollowups({
    procurement: { ...procurement, contract_end: null, tender_deadline: null },
    calloffs: [{ ...calloff, status: 'cancelled' }],
    rules: rules([{ id: 'r6', active: false }]),
    today: '2026-09-23'
  });
  assert.equal(plan.wanted.length, 0);
  assert.ok(plan.resolved.every((r) => r.calloffId === 'c1'));
});

test('planProcurementFollowups: excellens-regler gäller bara excellens-insatser', () => {
  const excellenceRule: ProcurementRule = {
    id: 'rx',
    name: 'Excellensrapport',
    scope: 'calloff',
    anchor: 'calloff_end',
    offset_days: 30,
    repeat: 'once',
    condition: 'always',
    applies_to: 'excellence',
    task_title: 'Rapportera excellens-insatsen {{startup}} till Vinnova',
    task_kind: 'admin',
    active: true
  };
  const plain = planProcurementFollowups({
    procurement: { ...procurement, is_excellence_activity: false },
    calloffs: [{ ...calloff, is_excellence_activity: false }],
    rules: [excellenceRule],
    today: '2026-09-23'
  });
  assert.equal(plain.wanted.length, 0);
  const inherited = planProcurementFollowups({
    procurement,
    calloffs: [{ ...calloff, is_excellence_activity: null }],
    rules: [excellenceRule],
    today: '2026-09-23'
  });
  assert.equal(inherited.wanted.length, 1);
  assert.match(inherited.wanted[0].title, /Vinnova/);
});

test('diffProcurementFollowups: skapar saknade, uppdaterar flyttade datum, stänger upphörda', () => {
  const plan = planProcurementFollowups({
    procurement,
    calloffs: [calloff],
    rules: rules(),
    today: '2026-09-23'
  });
  const diff = diffProcurementFollowups(plan, [
    { id: 't1', rule_key: 'r1:c1:0', status: 'open', due_at: '2026-10-01 00:00:00.000Z', description: 'gammal titel' },
    { id: 't2', rule_key: 'r6:p1:0', status: 'done', due_at: '2026-08-30', description: 'x' },
    { id: 't3', rule_key: 'r99:c1:0', status: 'open', due_at: '2026-09-01', description: 'borttagen regel' },
    { id: 't4', rule_key: 'r98:c1:0', status: 'cancelled', due_at: '2026-09-01', description: 'redan stängd' }
  ]);
  assert.ok(diff.toCreate.some((c) => c.key === 'r4:c1:0'));
  assert.ok(!diff.toCreate.some((c) => c.key === 'r1:c1:0'));
  assert.ok(!diff.toCreate.some((c) => c.key === 'r6:p1:0'), 'ett redan klart kort återskapas inte');
  assert.deepEqual(diff.toUpdate, [{ taskId: 't1', dueDate: '2026-10-13', title: plan.wanted.find((w) => w.key === 'r1:c1:0')!.title }]);
  assert.deepEqual(diff.toResolve, ['t3']);
});

test('diffProcurementFollowups: idempotent — andra körningen är tom', () => {
  const plan = planProcurementFollowups({ procurement, calloffs: [calloff], rules: rules(), today: '2026-09-23' });
  const existing = plan.wanted.map((w, i) => ({
    id: `t${i}`,
    rule_key: w.key,
    status: 'open',
    due_at: w.dueDate,
    description: w.title
  }));
  const diff = diffProcurementFollowups(plan, existing);
  assert.equal(diff.toCreate.length, 0);
  assert.equal(diff.toUpdate.length, 0);
  assert.equal(diff.toResolve.length, 0);
});

test('calloffPhase + calloffAlerts följer klockan', () => {
  assert.equal(calloffPhase({ ...calloff, status: 'planned', started_at: '2026-10-01' }, '2026-09-23'), 'planned');
  assert.equal(calloffPhase(calloff, '2026-09-23'), 'setup');
  assert.equal(calloffPhase({ ...calloff, milestone_1_approved_at: '2026-10-20' }, '2026-10-21'), 'coaching');
  assert.equal(calloffPhase(calloff, '2026-12-05'), 'awaiting_report');
  assert.equal(calloffPhase({ ...calloff, final_report_received_at: '2026-12-03' }, '2026-12-05'), 'awaiting_evaluation');
  assert.equal(calloffPhase({ ...calloff, evaluated_at: '2026-12-10' }, '2026-12-11'), 'done');
  assert.equal(calloffPhase({ ...calloff, status: 'cancelled' }, '2026-12-11'), 'cancelled');

  const late = calloffAlerts(calloff, '2026-11-01');
  assert.deepEqual(late.map((a) => a.kind), ['milestone_1_overdue']);
  assert.equal(late[0].daysLate, 5);
  const ended = calloffAlerts(calloff, '2026-12-05');
  assert.ok(ended.some((a) => a.kind === 'final_report_missing'));
  assert.ok(ended.some((a) => a.kind === 'milestone_2_overdue'));
  assert.equal(calloffAlerts({ ...calloff, evaluated_at: '2026-12-10' }, '2027-01-01').length, 0);
});

test('scoreProcurementEvaluation viktar och rapporterar saknade kriterier', () => {
  const full = scoreProcurementEvaluation(DEFAULT_PROCUREMENT_CRITERIA, {
    milstolpar_i_tid: 5,
    kvalitet: 4,
    kunskapsoverforing: 3,
    bolagets_nojdhet: 5,
    kostnadskontroll: 5
  });
  assert.equal(full.score, 4.25);
  assert.equal(full.pct, 85);
  assert.deepEqual(full.missing, []);

  const partial = scoreProcurementEvaluation(DEFAULT_PROCUREMENT_CRITERIA, { kvalitet: 2, kostnadskontroll: 4 });
  assert.equal(partial.score, 2.57);
  assert.equal(partial.missing.length, 3);

  const none = scoreProcurementEvaluation(DEFAULT_PROCUREMENT_CRITERIA, {});
  assert.equal(none.score, null);

  const clamped = scoreProcurementEvaluation([{ key: 'a', label: 'A', weight: 1 }], { a: 99 });
  assert.equal(clamped.score, 5);
});

test('normalizeProcurementCriteria: tomt → standard, dubbletter och ogiltiga vikter filtreras', () => {
  assert.equal(normalizeProcurementCriteria(null).length, DEFAULT_PROCUREMENT_CRITERIA.length);
  const custom = normalizeProcurementCriteria([
    { label: 'Leverans i tid', weight: 50 },
    { key: 'leverans_i_tid', label: 'Dubblett', weight: 10 },
    { label: 'Utan vikt', weight: 0 },
    { label: 'Pedagogisk förmåga', weight: '25' }
  ]);
  assert.deepEqual(custom.map((c) => c.key), ['leverans_i_tid', 'pedagogisk_formaga']);
  assert.equal(custom[1].weight, 25);
});

test('aggregateProcurementScore + summarizeProcurement', () => {
  const agg = aggregateProcurementScore([{ evaluation_score: 4 }, { evaluation_score: 3 }, { evaluation_score: null }]);
  assert.deepEqual(agg, { score: 3.5, evaluated: 2 });
  const s = summarizeProcurement(
    [calloff, { ...calloff, id: 'c2', evaluated_at: '2026-12-01', evaluation_score: 4 }],
    '2026-11-01'
  );
  assert.equal(s.calloffs, 2);
  assert.equal(s.activeCalloffs, 1);
  assert.equal(s.alerts, 1);
  assert.equal(s.score, 4);
});

test('validateProcurementRuleInput avvisar fel ankare/villkor för scope', () => {
  const bad = validateProcurementRuleInput({
    name: 'x',
    scope: 'procurement',
    anchor: 'milestone_1_due',
    task_title: 'y'
  });
  assert.equal(bad.ok, false);
  const badCond = validateProcurementRuleInput({
    name: 'x',
    scope: 'procurement',
    anchor: 'contract_end',
    condition: 'not_evaluated',
    task_title: 'y'
  });
  assert.equal(badCond.ok, false);
  const good = validateProcurementRuleInput({
    name: '  Kvartal ',
    scope: 'procurement',
    anchor: 'contract_start',
    offset_days: '90',
    repeat: 'quarterly',
    task_title: 'Avstämning {{supplier}}'
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.name, 'Kvartal');
    assert.equal(good.value.offset_days, 90);
    assert.equal(good.value.condition, 'always');
    assert.equal(good.value.task_kind, 'followup');
    assert.equal(good.value.active, true);
  }
  for (const r of DEFAULT_PROCUREMENT_RULES) {
    assert.equal(validateProcurementRuleInput(r).ok, true, r.name);
  }
});

test('normalizeCalloffTemplate + defaultCalloffDates med upphandlingens egen mall', () => {
  const norm = normalizeCalloffTemplate;
  const dd = defaultCalloffDates;
  const def = DEFAULT_CALLOFF_TEMPLATE;
  const t = norm({ milestone_1_days: '30', duration_days: 180, milestone_1_label: 'Leverans 1' });
  assert.equal(t.milestone_1_days, 30);
  assert.equal(t.duration_days, 180);
  assert.equal(t.milestone_1_label, 'Leverans 1');
  assert.equal(t.milestone_2_label, def.milestone_2_label);
  const d = dd('2026-01-01', t);
  assert.equal(d.milestone_1_due, '2026-01-31');
  assert.equal(d.ends_at, '2026-06-30');
  assert.equal(d.milestone_2_due, '2026-06-30');
  const noM1 = dd('2026-01-01', norm({ milestone_1_days: null, duration_days: 10 }));
  assert.equal(noM1.milestone_1_due, null);
  assert.equal(noM1.ends_at, '2026-01-11');
  assert.deepEqual(norm(null), def);
  assert.equal(norm({ milestone_1_days: 99999 }).milestone_1_days, null);
});

test('planProcurementFollowups: upphandlingsspecifika regler gäller bara sin upphandling', () => {
  const own: ProcurementRule = {
    id: 'own',
    name: 'Egen',
    procurement: 'p1',
    scope: 'procurement',
    anchor: 'contract_start',
    offset_days: 0,
    repeat: 'once',
    condition: 'always',
    applies_to: 'all',
    task_title: 'Kickoff {{title}}',
    task_kind: 'meeting',
    active: true
  };
  const other = { ...own, id: 'other', procurement: 'p2' };
  const plan = planProcurementFollowups({ procurement, calloffs: [], rules: [own, other], today: '2026-09-23' });
  assert.deepEqual(plan.wanted.map((w) => w.ruleId), ['own']);
});

test('parseProcurementDraft tvingar modellens svar in i den typade modellen', () => {
  const parse = parseProcurementDraft;
  const draft = parse({
    title: '  AI-stött   utvecklingsstöd ',
    supplier: '',
    procedure: 'RAMAVTAL',
    status: 'okänd',
    tender_deadline: '[DATUM]',
    contract_start: '2026-06-01',
    contract_end: '2026-05-01',
    extension_option_months: '12',
    estimated_value_sek: '1 200 000',
    estimated_calloffs: 3.4,
    is_excellence_activity: 'ja',
    evaluation_criteria: [{ label: 'Leverans', weight: 60 }, { label: 'Pris', weight: 40 }],
    calloff_template: { milestone_1_days: 56, duration_days: 91 },
    rules: [
      { name: 'Kvartal', scope: 'procurement', anchor: 'contract_start', offset_days: 90, repeat: 'quarterly', condition: 'always', task_title: 'Avstämning {{supplier}}', task_kind: 'meeting', source_note: 'avsnitt 6' },
      { name: 'Fel', scope: 'procurement', anchor: 'milestone_1_due', task_title: 'x' },
      { name: 'Slutrapport', scope: 'calloff', anchor: 'calloff_end', offset_days: 7, condition: 'final_report_missing', task_title: 'Begär slutrapport', task_kind: 'email' }
    ],
    confidence: '0.8'
  });
  assert.equal(draft.title, 'AI-stött utvecklingsstöd');
  assert.equal(draft.procedure, 'ramavtal');
  assert.equal(draft.status, 'planning');
  assert.equal(draft.tender_deadline, null);
  assert.equal(draft.contract_start, '2026-06-01');
  assert.equal(draft.contract_end, null, 'slut före start kastas');
  assert.equal(draft.extension_option_months, 12);
  assert.equal(draft.estimated_value_sek, 1200000);
  assert.equal(draft.estimated_calloffs, 3);
  assert.equal(draft.is_excellence_activity, false);
  assert.deepEqual(draft.evaluation_criteria.map((c) => c.key), ['leverans', 'pris']);
  assert.equal(draft.calloff_template.milestone_1_days, 56);
  assert.deepEqual(draft.rules.map((r) => r.name), ['Kvartal', 'Slutrapport']);
  assert.equal(draft.rules[0].source_note, 'avsnitt 6');
  assert.equal(draft.rules[1].repeat, 'once');
  assert.equal(draft.confidence, 0.8);
  assert.deepEqual(draft.missing, ['supplier', 'contract_end']);
  const empty = parse(null);
  assert.equal(empty.title, '');
  assert.equal(empty.evaluation_criteria.length, DEFAULT_PROCUREMENT_CRITERIA.length);
  assert.ok(empty.missing.includes('title'));
});
