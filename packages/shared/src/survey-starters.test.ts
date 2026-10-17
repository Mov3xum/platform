import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_TYPES } from './event-participants.ts';
import { normalizeSurveyQuestions } from './survey.ts';
import {
  SURVEY_STARTER_TEMPLATES,
  defaultEvaluationTemplateRef,
  getSurveyStarterTemplate,
  isStarterTemplateRef,
  pickStarterTemplateForEventType,
  starterTemplateRef
} from './survey-starters.ts';

test('varje eventtyp har exakt en standardmall', () => {
  for (const type of EVENT_TYPES) {
    const matches = SURVEY_STARTER_TEMPLATES.filter((t) => t.template_for.includes(type));
    assert.equal(matches.length, 1, `eventtyp ${type}`);
    assert.equal(pickStarterTemplateForEventType(type)?.key, matches[0]!.key);
  }
  assert.equal(pickStarterTemplateForEventType('okänd'), null);
});

test('mallarna är giltiga enkäter och jämförbara (helhet + NPS)', () => {
  const keys = new Set<string>();
  for (const t of SURVEY_STARTER_TEMPLATES) {
    assert.ok(!keys.has(t.key), `dubblerad nyckel ${t.key}`);
    keys.add(t.key);
    // Normaliseringen får inte släppa eller byta id på någon fråga.
    assert.deepEqual(normalizeSurveyQuestions(t.questions), t.questions, t.key);
    const helhet = t.questions.find((q) => q.id === 'helhet');
    assert.equal(helhet?.type, 'rating', t.key);
    assert.equal(helhet?.required, true, t.key);
    assert.equal(t.questions.find((q) => q.id === 'rekommendera')?.type, 'nps', t.key);
    assert.ok(t.name && t.summary && t.welcome_title && t.thank_you_message, t.key);
  }
});

test('referenser löses bara för kända mallar', () => {
  assert.equal(getSurveyStarterTemplate(starterTemplateRef('workshop'))?.name, 'Workshop & utbildning');
  assert.equal(getSurveyStarterTemplate('starter:finns-inte'), null);
  assert.equal(getSurveyStarterTemplate('template:abc'), null);
  assert.equal(getSurveyStarterTemplate(undefined), null);
  assert.equal(isStarterTemplateRef('starter:pitch'), true);
});

test('egen mall för eventtypen går före standardmallen', () => {
  const own = [{ id: 'abc', name: 'Vår frukost', template_for: ['mingle'] }];
  assert.equal(defaultEvaluationTemplateRef(own, 'mingle'), 'abc');
  assert.equal(defaultEvaluationTemplateRef(own, 'pitch'), 'starter:pitch');
  assert.equal(defaultEvaluationTemplateRef([], 'other'), 'starter:kort');
  assert.equal(defaultEvaluationTemplateRef(own, 'okänd'), null);
});
