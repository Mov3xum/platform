import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissingRequiredAlongPath,
  resolveNextQuestionIndex
} from './question-flow';
import type { CompassQuestion } from './types';

function q(
  key: string,
  opts: Partial<Pick<CompassQuestion, 'required' | 'choices' | 'input_type'>> = {}
): CompassQuestion {
  return {
    id: `id_${key}`,
    module: 'm1',
    key,
    prompt: `Fråga ${key}`,
    input_type: opts.input_type ?? 'short_text',
    required: opts.required,
    choices: opts.choices
  };
}

test('resolveNextQuestionIndex: går till nästa fråga utan hopplogik', () => {
  const questions = [q('a'), q('b'), q('c')];
  assert.equal(resolveNextQuestionIndex(questions, 0, 'svar'), 1);
  assert.equal(resolveNextQuestionIndex(questions, 2, 'svar'), 3);
});

test('resolveNextQuestionIndex: hoppar till next_key för valt alternativ', () => {
  const questions = [
    q('a', {
      input_type: 'choice',
      choices: [
        { value: 'ja', label: 'Ja', next_key: 'c' },
        { value: 'nej', label: 'Nej' }
      ]
    }),
    q('b'),
    q('c')
  ];
  assert.equal(resolveNextQuestionIndex(questions, 0, 'ja'), 2);
  assert.equal(resolveNextQuestionIndex(questions, 0, 'nej'), 1);
});

test('resolveNextQuestionIndex: hoppar aldrig bakåt (okänd next_key → nästa)', () => {
  const questions = [
    q('a'),
    q('b', {
      input_type: 'choice',
      choices: [{ value: 'x', label: 'X', next_key: 'a' }]
    }),
    q('c')
  ];
  assert.equal(resolveNextQuestionIndex(questions, 1, 'x'), 2);
});

test('findMissingRequiredAlongPath: kräver besvarade obligatoriska längs vägen', () => {
  const questions = [q('a', { required: true }), q('b', { required: true })];
  const missing = findMissingRequiredAlongPath(questions, { a: 'svar' });
  assert.equal(missing?.key, 'b');
});

test('findMissingRequiredAlongPath: frågor som grenats förbi blockerar INTE', () => {
  // a (val "ja" hoppar till c) — b är obligatorisk men ligger på den väg som
  // INTE togs → inskicket ska gå igenom.
  const questions = [
    q('a', {
      required: true,
      input_type: 'choice',
      choices: [
        { value: 'ja', label: 'Ja', next_key: 'c' },
        { value: 'nej', label: 'Nej' }
      ]
    }),
    q('b', { required: true }),
    q('c', { required: true })
  ];
  assert.equal(findMissingRequiredAlongPath(questions, { a: 'ja', c: 'klar' }), null);
  // Vägen via "nej" passerar b → b krävs.
  const missing = findMissingRequiredAlongPath(questions, { a: 'nej', c: 'klar' });
  assert.equal(missing?.key, 'b');
});

test('findMissingRequiredAlongPath: tomma svar räknas som saknade', () => {
  const questions = [q('a', { required: true })];
  assert.equal(findMissingRequiredAlongPath(questions, {})?.key, 'a');
  assert.equal(findMissingRequiredAlongPath(questions, { a: '' })?.key, 'a');
  assert.equal(findMissingRequiredAlongPath(questions, { a: [] })?.key, 'a');
  assert.equal(findMissingRequiredAlongPath(questions, { a: ['x'] }), null);
});

test('findMissingRequiredAlongPath: frivilliga frågor blockerar aldrig', () => {
  const questions = [q('a'), q('b', { required: true })];
  assert.equal(findMissingRequiredAlongPath(questions, { b: 'svar' }), null);
});
