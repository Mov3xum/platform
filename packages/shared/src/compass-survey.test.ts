import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SURVEY_TEMPLATES,
  aggregateSurvey,
  findSurveyTemplate,
  isSurveyModule,
  isValidSurveySubjectId,
  normalizeCompassPurpose,
  normalizeSurveySubjectKind,
  satisfiedShare,
  validateSurveyAnswer,
  type SurveyAnswerRow
} from './compass-survey.ts';
import { isCompassInputType } from './compass-authoring.ts';

const questions = [
  { key: 'nojdhet', prompt: 'Nöjdhet', input_type: 'scale' },
  { key: 'nps', prompt: 'Rekommendera?', input_type: 'scale' },
  { key: 'kommentar', prompt: 'Kommentar', input_type: 'long_text' }
];

function rows(n: number, nojdhet: (i: number) => number, nps: (i: number) => number): SurveyAnswerRow[] {
  const out: SurveyAnswerRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ response_id: `r${i}`, question_key: 'nojdhet', value: String(nojdhet(i)) });
    out.push({ response_id: `r${i}`, question_key: 'nps', value: String(nps(i)) });
    out.push({ response_id: `r${i}`, question_key: 'kommentar', value: 'text' });
  }
  return out;
}

test('normalisering: saknat syfte är intag, okänt subjekt är none', () => {
  assert.equal(normalizeCompassPurpose(undefined), 'intake');
  assert.equal(normalizeCompassPurpose('survey'), 'survey');
  assert.equal(normalizeCompassPurpose('annat'), 'intake');
  assert.equal(isSurveyModule({ purpose: 'survey' }), true);
  assert.equal(isSurveyModule({}), false);
  assert.equal(isSurveyModule(null), false);
  assert.equal(normalizeSurveySubjectKind('event'), 'event');
  assert.equal(normalizeSurveySubjectKind('x'), 'none');
  assert.ok(isValidSurveySubjectId('abc123XYZ_-'));
  assert.ok(!isValidSurveySubjectId('a b'));
  assert.ok(!isValidSurveySubjectId('x'.repeat(65)));
});

test('aggregateSurvey: under k respondenter visas inga värden', () => {
  const agg = aggregateSurvey(rows(4, () => 5, () => 10), questions, { npsKeys: ['nps'] });
  assert.equal(agg.respondents, 4);
  assert.equal(agg.visible, false);
  assert.equal(agg.score, null);
  assert.equal(agg.nps, null);
  assert.ok(agg.questions.every((q) => q.mean === null && Object.keys(q.distribution).length === 0));
  // Antalet svar per fråga rapporteras ändå (ingen PII i ett antal).
  assert.equal(agg.questions[0].count, 4);
});

test('aggregateSurvey: medel, fördelning, NPS och samlat score vid k+', () => {
  const agg = aggregateSurvey(
    rows(6, (i) => [5, 4, 4, 3, 5, 4][i], (i) => [10, 9, 7, 6, 3, 9][i]),
    questions,
    { npsKeys: ['nps'] }
  );
  assert.equal(agg.visible, true);
  const nojdhet = agg.questions.find((q) => q.key === 'nojdhet')!;
  assert.equal(nojdhet.mean, 4.2);
  assert.deepEqual(nojdhet.distribution, { '5': 2, '4': 3, '3': 1 });
  assert.equal(nojdhet.nps, null, 'vanlig skala ger ingen NPS');
  const nps = agg.questions.find((q) => q.key === 'nps')!;
  // 3 promoters (10, 9, 9), 2 detractors (6, 3) av 6 → (3−2)/6 = 17 %
  assert.equal(nps.nps, 17);
  assert.equal(agg.nps, 17);
  // Samlat score = medel över skalfrågor som inte är NPS.
  assert.equal(agg.score, 4.2);
  const text = agg.questions.find((q) => q.key === 'kommentar')!;
  assert.equal(text.mean, null);
  assert.equal(text.count, 6);
});

test('satisfiedShare: andel ≥ 7 av 10 med respondenttröskel', () => {
  const r = rows(5, (i) => [9, 7, 3, 8, 5][i], () => 5);
  assert.equal(satisfiedShare(r, 'nojdhet'), 60);
  assert.equal(satisfiedShare(rows(3, () => 5, () => 5), 'nojdhet'), null);
});

test('mallarna är giltiga: unika nycklar, kända frågetyper, minst en skalfråga', () => {
  const keys = new Set<string>();
  for (const t of SURVEY_TEMPLATES) {
    assert.ok(!keys.has(t.key), `dubblettmall ${t.key}`);
    keys.add(t.key);
    const qKeys = new Set<string>();
    for (const q of t.questions) {
      assert.ok(isCompassInputType(q.input_type), `${t.key}: okänd frågetyp ${q.input_type}`);
      assert.ok(!qKeys.has(q.key), `${t.key}: dubblettfråga ${q.key}`);
      qKeys.add(q.key);
    }
    assert.ok(t.questions.some((q) => q.input_type === 'scale'), `${t.key}: saknar skalfråga`);
    assert.ok(t.consent_note.length > 20);
  }
  assert.equal(findSurveyTemplate('medarbetarindex')?.anonymous, true);
  assert.equal(findSurveyTemplate('nope'), null);
});

test('validateSurveyAnswer: skala måste vara heltal 1–10, val måste finnas, fritext cappas', () => {
  const scale = { input_type: 'scale' };
  assert.equal(validateSurveyAnswer(scale, '7'), '7');
  assert.equal(validateSurveyAnswer(scale, '100000'), null);
  assert.equal(validateSurveyAnswer(scale, '0'), null);
  assert.equal(validateSurveyAnswer(scale, '7,5'), null);
  assert.equal(validateSurveyAnswer(scale, ''), null);
  const choice = { input_type: 'choice', choices: [{ value: 'a' }, { value: 'b' }] };
  assert.equal(validateSurveyAnswer(choice, 'b'), 'b');
  assert.equal(validateSurveyAnswer(choice, 'zzz'), null);
  const multi = { input_type: 'multi_choice', choices: [{ value: 'a' }, { value: 'b' }] };
  assert.equal(validateSurveyAnswer(multi, ['b', 'x', 'a', 'a']), 'b, a');
  assert.equal(validateSurveyAnswer(multi, ['x']), null);
  assert.equal(validateSurveyAnswer({ input_type: 'long_text' }, 'x'.repeat(3000))?.length, 2000);
  assert.equal(validateSurveyAnswer({ input_type: 'email' }, 'inte en adress'), null);
});

test('aggregateSurvey ignorerar skalvärden utanför 1–10 (extra skydd)', () => {
  const r: SurveyAnswerRow[] = [];
  for (let i = 0; i < 6; i++) r.push({ response_id: `r${i}`, question_key: 'nojdhet', value: i === 0 ? '100000' : '8' });
  const agg = aggregateSurvey(r, [questions[0]]);
  assert.equal(agg.questions[0].mean, 8);
});
