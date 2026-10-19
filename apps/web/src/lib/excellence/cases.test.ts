import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScreeningCaseId, normalizeScreeningCaseStatus, planCaseSync, resolveCaseTarget } from './cases';

const open = (id: string, org_nr = '5595728790') => ({ id, org_nr, status: 'open' as const });

test('ett uttryckligt ärende för samma bolag vinner', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('a1'), existingForOrg: open('b2'), create: true }), {
    kind: 'update',
    id: 'a1',
    reopen: false
  });
});

test('en ändring i ett klarmarkerat ärende öppnar det igen', () => {
  assert.deepEqual(
    resolveCaseTarget({ orgNr: '5595728790', requested: { id: 'd1', org_nr: '5595728790', status: 'done' }, create: false }),
    { kind: 'update', id: 'd1', reopen: true }
  );
});

test('ett ärende för ett annat bolag skrivs aldrig över', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('x', '5560000001'), create: true }), { kind: 'create' });
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('x', '5560000001'), create: false }), { kind: 'skip' });
});

test('ett pågående ärende för samma org-nr fylls på i stället för en dubblett', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', existingForOrg: open('b2'), create: true }), {
    kind: 'update',
    id: 'b2',
    reopen: false
  });
});

test('ett klarmarkerat ärende för bolaget återanvänds och blir pågående igen (ingen dubblett)', () => {
  assert.deepEqual(
    resolveCaseTarget({ orgNr: '5595728790', existingForOrg: { id: 'd', org_nr: '5595728790', status: 'done' }, create: true }),
    { kind: 'update', id: 'd', reopen: true }
  );
});

test('utan ärende och utan rätt att skapa: inget sparas', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', create: false }), { kind: 'skip' });
});

test('id och status valideras', () => {
  assert.equal(isScreeningCaseId('abc123'), true);
  assert.equal(isScreeningCaseId('a"b'), false);
  assert.equal(isScreeningCaseId(''), false);
  assert.equal(normalizeScreeningCaseStatus('done'), 'done');
  assert.equal(normalizeScreeningCaseStatus('x'), 'open');
});

const run = (id: string, startup: string, assessed_at: string, org_nr?: string) => ({ id, startup, assessed_at, org_nr });

test('ett bedömt bolag utan ärende får ett pågående ärende från sin senaste körning', () => {
  const plan = planCaseSync(
    [run('r1', 's1', '2026-10-01 10:00:00.000Z'), run('r2', 's1', '2026-10-05 10:00:00.000Z'), run('r3', 's2', '2026-09-01 10:00:00.000Z')],
    []
  );
  assert.deepEqual(plan.create.map((r) => r.id), ['r2', 'r3']);
  assert.deepEqual(plan.reopen, []);
});

test('bolag med pågående ärende rörs inte; ärende matchas även på org-nr', () => {
  const plan = planCaseSync(
    [run('r1', 's1', '2026-10-05 10:00:00.000Z'), run('r2', 's2', '2026-10-05 10:00:00.000Z', '5595728790')],
    [
      { id: 'c1', startup: 's1', org_nr: '5560000001', status: 'open' },
      { id: 'c2', org_nr: '5595728790', status: 'open' }
    ]
  );
  assert.deepEqual(plan, { create: [], reopen: [] });
});

test('klarmarkerat ärende blir pågående igen när bolaget bedömts efter klarmarkeringen', () => {
  const cases = [{ id: 'd1', startup: 's1', org_nr: '5560000001', status: 'done' as const, completed_at: '2026-10-05 10:00:05.000Z' }];
  // Slutbedömningens egen körning (före klarmarkeringen) öppnar inte ärendet.
  assert.deepEqual(planCaseSync([run('r1', 's1', '2026-10-05 10:00:00.000Z')], cases).reopen, []);
  assert.deepEqual(planCaseSync([run('r2', 's1', '2026-10-07T09:00:00.000Z')], cases).reopen, ['d1']);
});

test('nya ärenden per synk är kapade', () => {
  const runs = Array.from({ length: 30 }, (_, i) => run(`r${i}`, `s${i}`, `2026-10-01 10:${String(i).padStart(2, '0')}:00.000Z`));
  assert.equal(planCaseSync(runs, [], 5).create.length, 5);
});
