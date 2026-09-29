import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOLLOWUP_RULE_MAX_OCCURRENCES,
  diffFollowups,
  fillFollowupTemplate,
  planFollowups,
  validateFollowupRuleBase,
  type FollowupAdapter,
  type FollowupRuleBase
} from './followup-rules.ts';
import {
  DEFAULT_PROCUREMENT_RULES,
  createProcurementFollowupAdapter,
  diffProcurementFollowups,
  planProcurementFollowups,
  type ProcurementCalloffLike,
  type ProcurementLike
} from './procurement.ts';

// ─── En leksaksdomän: "avtal" med förnyelsedatum ────────────────────────────

interface RenewalRule extends FollowupRuleBase {
  anchor: 'renews_at' | 'signed_at';
  condition: 'not_renewed' | 'always';
}
interface Contract {
  id: string;
  name: string;
  signed_at: string | null;
  renews_at: string | null;
  renewed: boolean;
  terminated: boolean;
}

function renewalAdapter(contracts: readonly Contract[]): FollowupAdapter<RenewalRule, Contract, { contractId: string }> {
  return {
    keyPrefix: 'renew:',
    targets: () => contracts,
    targetId: (_r, c) => c.id,
    ruleApplies: () => true,
    anchorDate: (r, c) => (r.anchor === 'renews_at' ? c.renews_at : c.signed_at),
    untilDate: (_r, c) => c.renews_at,
    cancelled: (_r, c) => c.terminated,
    conditionHolds: (r, c) => (r.condition === 'always' ? true : !c.renewed),
    titleVars: (_r, c) => ({ name: c.name }),
    extra: (_r, c) => ({ contractId: c.id })
  };
}

const contracts: Contract[] = [
  { id: 'a', name: 'Region Gävleborg', signed_at: '2026-01-15', renews_at: '2026-12-31', renewed: false, terminated: false },
  { id: 'b', name: 'Sandvik', signed_at: '2026-03-01', renews_at: '2026-12-31', renewed: true, terminated: false },
  { id: 'c', name: 'Hävt avtal', signed_at: '2026-03-01', renews_at: '2026-12-31', renewed: false, terminated: true },
  { id: 'd', name: 'Utan datum', signed_at: null, renews_at: null, renewed: false, terminated: false }
];

const renewRule: RenewalRule = {
  id: 'rr1',
  anchor: 'renews_at',
  condition: 'not_renewed',
  offset_days: -90,
  repeat: 'once',
  task_title: 'Besluta om förlängning: {{name}}',
  task_kind: 'followup',
  active: true
};

test('planFollowups: ankare + offset, villkor → wanted/resolved, hävt mål → resolved, saknat ankare → inget', () => {
  const plan = planFollowups(renewalAdapter(contracts), [renewRule]);
  assert.deepEqual(
    plan.wanted.map((w) => [w.key, w.dueDate, w.title, w.contractId]),
    [['renew:rr1:a:0', '2026-10-02', 'Besluta om förlängning: Region Gävleborg', 'a']]
  );
  // b (redan förnyat) och c (hävt) hamnar i resolved så öppna kort auto-stängs; d saknar ankare.
  assert.deepEqual(plan.resolved.map((w) => w.key).sort(), ['renew:rr1:b:0', 'renew:rr1:c:0']);
});

test('planFollowups: upprepning löper från ankaret till untilDate med hårt tak, inaktiv regel ger inget', () => {
  const quarterly: RenewalRule = {
    ...renewRule,
    id: 'q',
    anchor: 'signed_at',
    condition: 'always',
    offset_days: 0,
    repeat: 'quarterly',
    task_title: 'Kvartalsavstämning {{name}}'
  };
  const plan = planFollowups(renewalAdapter([contracts[0]]), [quarterly]);
  assert.deepEqual(
    plan.wanted.map((w) => w.dueDate),
    ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']
  );
  const monthlyNoEnd = planFollowups(
    renewalAdapter([{ ...contracts[0], renews_at: null }]),
    [{ ...quarterly, anchor: 'signed_at', repeat: 'monthly' }]
  );
  // Utan slutdatum begränsar bara taket (renews_at är både ankare-alternativ och slut här: signed_at används).
  assert.equal(monthlyNoEnd.wanted.length, FOLLOWUP_RULE_MAX_OCCURRENCES);
  assert.equal(planFollowups(renewalAdapter(contracts), [{ ...renewRule, active: false }]).wanted.length, 0);
});

test('planFollowups: nycklarna är deterministiska och namnrymda per adapter', () => {
  const a = planFollowups(renewalAdapter(contracts), [renewRule]);
  const b = planFollowups(renewalAdapter([...contracts].reverse()), [renewRule]);
  assert.deepEqual(a.wanted.map((w) => w.key), b.wanted.map((w) => w.key));
  assert.ok(a.wanted.every((w) => w.key.startsWith('renew:')));
});

test('diffFollowups: skapar, flyttar, auto-stänger — och rör aldrig mänskligt stängda kort', () => {
  const plan = planFollowups(renewalAdapter(contracts), [renewRule]);
  const diff = diffFollowups(plan, [
    { id: 't-b', rule_key: 'renew:rr1:b:0', status: 'open', due_at: '2026-10-02', description: 'x' },
    { id: 't-old', rule_key: 'renew:gammal:a:0', status: 'done', due_at: '2026-01-01', description: 'klar' }
  ]);
  assert.deepEqual(diff.toCreate.map((c) => c.key), ['renew:rr1:a:0']);
  assert.deepEqual(diff.toUpdate, []);
  assert.deepEqual(diff.toResolve, ['t-b']);
});

test('fillFollowupTemplate: fyller kända platshållare, lämnar okända synliga, kollapsar mellanslag och cappar', () => {
  assert.equal(fillFollowupTemplate('Stäm av  {{ name }} med {{who}}', { name: 'Fixkod' }), 'Stäm av Fixkod med {{who}}');
  assert.equal(fillFollowupTemplate('x'.repeat(600), {}).length, 500);
});

test('validateFollowupRuleBase: kärnvalidering delas av alla domäner', () => {
  assert.equal(validateFollowupRuleBase({ name: '', task_title: 'x' }).ok, false);
  assert.equal(validateFollowupRuleBase({ name: 'n', offset_days: 1000, task_title: 'x' }).ok, false);
  assert.equal(validateFollowupRuleBase({ name: 'n', offset_days: 1.5, task_title: 'x' }).ok, false);
  assert.equal(validateFollowupRuleBase({ name: 'n', repeat: 'weekly', task_title: 'x' }).ok, false);
  assert.equal(validateFollowupRuleBase({ name: 'n', task_title: 'x', task_kind: 'party' }).ok, false);
  const ok = validateFollowupRuleBase({ name: ' n ', offset_days: -14, task_title: ' t ' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { name: 'n', offset_days: -14, repeat: 'once', task_title: 't', task_kind: 'followup', active: true });
});

// ─── Upphandlingen som adapter: befintliga nycklar och beteende bevaras ─────

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
const procRules = DEFAULT_PROCUREMENT_RULES.map((r, i) => ({ ...r, id: `r${i + 1}` }));

test('procurement-adaptern: keyPrefix är tomt så redan skapade kort (rule_key utan prefix) förblir idempotenta', () => {
  const adapter = createProcurementFollowupAdapter(procurement, [calloff]);
  assert.equal(adapter.keyPrefix, '');
  const plan = planProcurementFollowups({ procurement, calloffs: [calloff], rules: procRules, today: '2026-09-23' });
  assert.ok(plan.wanted.every((w) => /^r\d+:(c1|p1):\d+$/.test(w.key)));
  // Den generiska vägen ger exakt samma plan som det publika namnet.
  const generic = planFollowups(adapter, procRules);
  assert.deepEqual(generic, plan);
  // Andra körningen mot sin egen plan är tom (idempotens).
  const existing = plan.wanted.map((w, i) => ({ id: `t${i}`, rule_key: w.key, status: 'open', due_at: w.dueDate, description: w.title }));
  const diff = diffProcurementFollowups(plan, existing);
  assert.equal(diff.toCreate.length + diff.toUpdate.length + diff.toResolve.length, 0);
});
