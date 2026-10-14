import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closingQuestions,
  countsInStatistics,
  isStaleInProgress,
  missingClosingField,
  normalizeLeadCompletion,
  progressNote
} from './completion';
import type { CompassQuestion } from './types';

function q(key: string, required = false): CompassQuestion {
  return { id: `id_${key}`, module: 'm', key, prompt: `Fråga ${key}`, input_type: 'short_text', required };
}

test('saknat fält tolkas som slutförd (oapplicerad migration ändrar inget)', () => {
  assert.equal(normalizeLeadCompletion(undefined), 'completed');
  assert.equal(normalizeLeadCompletion(''), 'completed');
  assert.equal(normalizeLeadCompletion('abandoned'), 'abandoned');
  assert.equal(normalizeLeadCompletion('in_progress'), 'in_progress');
  assert.equal(countsInStatistics(undefined), true);
  assert.equal(countsInStatistics('abandoned'), false);
  assert.equal(countsInStatistics('in_progress'), false);
});

test('pågående lead blir inaktuellt efter tidsgränsen — aldrig ett slutfört', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const old = new Date(now - 3 * 3600_000).toISOString();
  const fresh = new Date(now - 10 * 60_000).toISOString();
  assert.equal(isStaleInProgress({ completion: 'in_progress', updated: old }, now), true);
  assert.equal(isStaleInProgress({ completion: 'in_progress', updated: fresh }, now), false);
  assert.equal(isStaleInProgress({ completion: 'completed', updated: old }, now), false);
  assert.equal(isStaleInProgress({ completion: 'in_progress' }, now), false);
});

test('avslutssteget ställer bara obligatoriska frågor', () => {
  const qs = [q('a', true), q('b'), q('c', true)];
  assert.deepEqual(
    closingQuestions(qs).map((x) => x.key),
    ['a', 'c']
  );
});

test('missingClosingField: obligatoriska frågor före kontaktfält, null när allt finns', () => {
  const questions = [q('idea', true), q('extra')];
  assert.match(
    missingClosingField({ questions, answers: {}, contact: {}, requirements: {} }) ?? '',
    /Fråga idea/
  );
  assert.equal(
    missingClosingField({
      questions,
      answers: { idea: 'En app' },
      contact: {},
      requirements: { requireEmail: true }
    }),
    'E-post krävs.'
  );
  assert.equal(
    missingClosingField({
      questions,
      answers: { idea: 'En app' },
      contact: { email: 'a@b.se' },
      requirements: { requireEmail: true, requirePhone: true }
    }),
    'Telefon krävs.'
  );
  assert.equal(
    missingClosingField({
      questions,
      answers: { idea: 'En app' },
      contact: { email: 'a@b.se', phone: '070', organization: 'AB' },
      requirements: { requireEmail: true, requirePhone: true, requireOrganization: true }
    }),
    null
  );
  // Tomma listor/blanksteg räknas inte som svar.
  assert.match(
    missingClosingField({ questions, answers: { idea: '   ' }, contact: {}, requirements: {} }) ?? '',
    /obligatoriskt/
  );
});

test('progressNote är PII-fri och klampar', () => {
  assert.equal(progressNote({ step: 2, total: 5, flow: 'formuläret' }), 'Påbörjade formuläret: 2 av 5 frågor besvarade.');
  assert.equal(progressNote({ step: 9, total: 5, flow: 'quizet' }), 'Påbörjade quizet: 5 av 5 frågor besvarade.');
  assert.equal(progressNote({ step: 0, total: 0, flow: 'chatten' }), 'Påbörjade chatten.');
});
