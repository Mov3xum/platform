import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScreeningCaseId, normalizeScreeningCaseStatus, resolveCaseTarget } from './cases';

const open = (id: string, org_nr = '5595728790') => ({ id, org_nr, status: 'open' as const });

test('ett uttryckligt ärende för samma bolag vinner', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('a1'), openForOrg: open('b2'), create: true }), {
    kind: 'update',
    id: 'a1'
  });
});

test('ett klarmarkerat ärende kan fortsättas när det öppnas uttryckligen', () => {
  assert.deepEqual(
    resolveCaseTarget({ orgNr: '5595728790', requested: { id: 'd1', org_nr: '5595728790', status: 'done' }, create: false }),
    { kind: 'update', id: 'd1' }
  );
});

test('ett ärende för ett annat bolag skrivs aldrig över', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('x', '5560000001'), create: true }), { kind: 'create' });
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', requested: open('x', '5560000001'), create: false }), { kind: 'skip' });
});

test('ett pågående ärende för samma org-nr fylls på i stället för en dubblett', () => {
  assert.deepEqual(resolveCaseTarget({ orgNr: '5595728790', openForOrg: open('b2'), create: true }), { kind: 'update', id: 'b2' });
});

test('ett klarmarkerat ärende återanvänds inte automatiskt', () => {
  assert.deepEqual(
    resolveCaseTarget({ orgNr: '5595728790', openForOrg: { id: 'd', org_nr: '5595728790', status: 'done' }, create: true }),
    { kind: 'create' }
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
