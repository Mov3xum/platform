import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SURVEY_KINDS,
  SURVEY_TEMPLATES,
  aggregateSurvey,
  computeNps,
  normalizeSurveyQuestions,
  validateSurveyAnswers,
  parseSurveyLinkRef,
  collectSurveyRecipients,
  defaultSurveySendAt,
  surveyLinkHref,
  surveyLinkRefParam,
  type SurveyQuestion
} from './survey.ts';

const questions: SurveyQuestion[] = [
  { id: 'betyg', type: 'rating', prompt: 'Betyg', required: true },
  { id: 'nps', type: 'nps', prompt: 'NPS', required: false },
  { id: 'val', type: 'choice', prompt: 'Val', required: false, choices: ['A', 'B'] },
  { id: 'flera', type: 'multi_choice', prompt: 'Flera', required: false, choices: ['X', 'Y', 'Z'] },
  { id: 'jn', type: 'yes_no', prompt: 'JN', required: false },
  { id: 'text', type: 'long_text', prompt: 'Text', required: false }
];

test('normalize: släpper ogiltiga frågor och gör id:n unika', () => {
  const out = normalizeSurveyQuestions([
    { id: 'Bra!', type: 'rating', prompt: ' Hur bra? ', required: true },
    { id: 'Bra!', type: 'nps', prompt: 'Igen' },
    { type: 'okand', prompt: 'x' },
    { type: 'rating', prompt: '' },
    { type: 'choice', prompt: 'Ett val', choices: ['Bara ett'] },
    { type: 'choice', prompt: 'Två val', choices: ['A', ' A ', 'B', 3] },
    'skräp'
  ]);
  assert.deepEqual(out.map((x) => x.id), ['bra', 'bra-2', 'tva-val']);
  assert.equal(out[0].prompt, 'Hur bra?');
  assert.equal(out[0].required, true);
  assert.deepEqual(out[2].choices, ['A', 'B']);
  assert.deepEqual(normalizeSurveyQuestions('nej'), []);
});

test('validate: rensar okända nycklar och kräver obligatoriska', () => {
  const ok = validateSurveyAnswers(questions, { betyg: '4', okand: 'x', flera: ['X', 'X'] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.answers, { betyg: 4, flera: ['X'] });

  const missing = validateSurveyAnswers(questions, { nps: 9 });
  assert.equal(missing.ok, false);
});

test('validate: avvisar värden utanför intervall/alternativ', () => {
  assert.equal(validateSurveyAnswers(questions, { betyg: 6 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { betyg: 3, nps: 11 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { betyg: 3, val: 'C' }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { betyg: 3, flera: ['Q'] }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { betyg: 3, jn: 'kanske' }).ok, false);
  assert.equal(validateSurveyAnswers([{ ...questions[0], required: false }], {}).ok, false);
});

test('nps: promoters minus detractors', () => {
  const r = computeNps([10, 9, 8, 7, 6, 0]);
  assert.deepEqual(r, { score: 0, promoters: 2, passives: 2, detractors: 2, total: 6 });
  assert.equal(computeNps([]).score, null);
  assert.equal(computeNps([10, 10, 9]).score, 100);
});

test('aggregate: medel, fördelning och fritext', () => {
  const s = aggregateSurvey(questions, [
    { betyg: 5, nps: 10, val: 'A', flera: ['X', 'Y'], jn: 'yes', text: 'Bra' },
    { betyg: 3, nps: 4, val: 'A', flera: ['Y'], jn: 'no' }
  ]);
  assert.equal(s.responses, 2);
  const by = Object.fromEntries(s.questions.map((x) => [x.id, x]));
  assert.equal(by.betyg.average, 4);
  assert.equal(by.betyg.distribution?.find((d) => d.label === '5')?.count, 1);
  assert.equal(by.nps.nps?.score, 0);
  assert.equal(by.val.distribution?.find((d) => d.label === 'A')?.count, 2);
  assert.equal(by.flera.distribution?.find((d) => d.label === 'Y')?.count, 2);
  assert.equal(by.jn.distribution?.[0].count, 1);
  assert.deepEqual(by.text.texts, ['Bra']);
  assert.equal(by.text.answered, 1);
});

test('mallar: alla typer har giltiga, normaliserade frågor', () => {
  for (const kind of SURVEY_KINDS) {
    const t = SURVEY_TEMPLATES[kind];
    assert.equal(normalizeSurveyQuestions(t.questions).length, t.questions.length, kind);
  }
});

test('länkreferens: tolkar bara kända typer och ofarliga id:n', () => {
  assert.deepEqual(parseSurveyLinkRef('event:abc123'), { kind: 'event', id: 'abc123' });
  assert.equal(parseSurveyLinkRef('users:abc'), null);
  assert.equal(parseSurveyLinkRef('event:'), null);
  assert.equal(parseSurveyLinkRef('event:a b'), null);
  assert.equal(parseSurveyLinkRef(42), null);
  const ref = parseSurveyLinkRef('annual_wheel:x1')!;
  assert.equal(surveyLinkRefParam(ref), 'annual_wheel:x1');
  assert.equal(surveyLinkHref(ref), '/arshjul?item=x1');
  assert.equal(surveyLinkHref({ kind: 'compass_module', id: 'm' }, 'slug-x'), '/inflode/admin/modules/slug-x');
  assert.equal(surveyLinkHref({ kind: 'compass_module', id: 'm' }), '/inflode/admin/modules');
});

test('mottagare: giltiga, dedupliserade, gemener', () => {
  const r = collectSurveyRecipients([
    { email: ' Anna@Example.se ' },
    { email: 'anna@example.se' },
    { email: 'ogiltig' },
    { email: '' },
    { email: null },
    { email: 'b@c.io' }
  ]);
  assert.deepEqual(r, ['anna@example.se', 'b@c.io']);
});

test('utskickstid: 09:00 svensk tid dagen efter eventets slut', () => {
  // Sommartid: 2026-06-10 18:00 svensk tid = 16:00Z → 11 juni 09:00 = 07:00Z
  const at = defaultSurveySendAt({ ends_at: '2026-06-10T16:00:00.000Z' });
  assert.equal(at?.toISOString(), '2026-06-11T07:00:00.000Z');
  // Vintertid, bara start: 2026-01-20 23:30 svensk tid = 22:30Z
  const w = defaultSurveySendAt({ starts_at: '2026-01-20T22:30:00.000Z' });
  assert.equal(w?.toISOString(), '2026-01-21T08:00:00.000Z');
  assert.equal(defaultSurveySendAt({}), null);
  assert.equal(defaultSurveySendAt({ starts_at: 'nej' }), null);
});
