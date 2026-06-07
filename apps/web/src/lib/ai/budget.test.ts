import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBudgetUsd, isOverBudget, monthStartIso, AiBudgetExceededError } from './budget';

// Låser den hårda kostnadsspärrens rena logik (CLAUDE.md § 10.1 robusthet).

test('resolveBudgetUsd: osatt/0/ogiltigt → spärren av (0)', () => {
  assert.equal(resolveBudgetUsd(undefined), 0);
  assert.equal(resolveBudgetUsd(''), 0);
  assert.equal(resolveBudgetUsd('0'), 0);
  assert.equal(resolveBudgetUsd('-5'), 0);
  assert.equal(resolveBudgetUsd('abc'), 0);
});

test('resolveBudgetUsd: giltigt positivt tal parsas', () => {
  assert.equal(resolveBudgetUsd('100'), 100);
  assert.equal(resolveBudgetUsd('49.5'), 49.5);
});

test('isOverBudget: bara när tak satt OCH förbrukat', () => {
  assert.equal(isOverBudget(0, 0), false); // spärren av
  assert.equal(isOverBudget(9999, 0), false); // spärren av oavsett spend
  assert.equal(isOverBudget(50, 100), false); // under tak
  assert.equal(isOverBudget(100, 100), true); // exakt på tak → blockera
  assert.equal(isOverBudget(150, 100), true); // över tak
});

test('monthStartIso: första ms i UTC-månaden i PB-format', () => {
  assert.equal(monthStartIso(new Date('2026-06-07T13:45:00Z')), '2026-06-01 00:00:00.000Z');
  assert.equal(monthStartIso(new Date('2026-01-31T23:59:59Z')), '2026-01-01 00:00:00.000Z');
  // UTC-gräns: en tidpunkt strax efter månadsskiftet i UTC hör till nya månaden.
  assert.equal(monthStartIso(new Date('2026-03-01T00:00:01Z')), '2026-03-01 00:00:00.000Z');
});

test('AiBudgetExceededError bär spend/budget och ett begripligt meddelande', () => {
  const err = new AiBudgetExceededError(123.4, 100);
  assert.equal(err.spentUsd, 123.4);
  assert.equal(err.budgetUsd, 100);
  assert.match(err.message, /budget/i);
  assert.ok(err instanceof Error);
});
