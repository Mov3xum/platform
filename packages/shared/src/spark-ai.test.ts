import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSparkIntroDraft,
  extractSparkJson,
  parseSparkAssessmentSuggestion,
  sanitizeSparkVector,
  sparkCosine,
  sparkEmbeddingText,
  sparkSemanticFor,
  sparkSemanticLevels,
  sparkTextHash
} from './spark-ai.ts';
import { rankSolutionsForNeed, scoreNeedSolution } from './spark-matching.ts';

test('embeddingtexten bär verksamhetstext och områden, aldrig "Annat"', () => {
  const t = sparkEmbeddingText('need', { title: 'Spillvärme går förlorad', description: 'Ugnarna släpper ut värme.', areas: ['spillvarme', 'annat'] });
  assert.match(t, /Spillvärme går förlorad/);
  assert.match(t, /Energiområden: Spillvärme och värmeåtervinning/);
  assert.doesNotMatch(t, /Annat/);
  const s = sparkEmbeddingText('solution', { name: 'Värmeväxlare', description: 'Återvinner värme.', problem: 'Outnyttjad värme' });
  assert.match(s, /Löser: Outnyttjad värme/);
  assert.match(sparkEmbeddingText('need', { description: 'Ring 19850101-1234' }), /\[REDACTED\]/);
});

test('kontrollsumman är stabil och ändras med texten', () => {
  assert.equal(sparkTextHash('abc'), sparkTextHash('abc'));
  assert.notEqual(sparkTextHash('abc'), sparkTextHash('abd'));
  assert.equal(sparkTextHash('').length, 8);
});

test('cosinus och vektorrensning', () => {
  assert.equal(sparkCosine([1, 0], [1, 0]), 1);
  assert.equal(sparkCosine([1, 0], [0, 1]), 0);
  assert.equal(sparkCosine([], [1]), 0);
  assert.deepEqual(sanitizeSparkVector([0.1, 0.2]), [0.1, 0.2]);
  assert.deepEqual(sanitizeSparkVector([0.1, 'x']), []);
  assert.deepEqual(sanitizeSparkVector('nej'), []);
});

test('likhet är relativ: bara det som sticker ut bland kandidaterna ger signal', () => {
  const flat = [0.8, 0.81, 0.79, 0.8, 0.8, 0.81].map((sim, i) => ({ id: `s${i}`, sim }));
  assert.equal(sparkSemanticLevels(flat).size, 0, 'tätt och jämnt ⇒ ingen sticker ut');
  const spread = [
    { id: 'a', sim: 0.95 },
    { id: 'b', sim: 0.86 },
    ...[0.7, 0.71, 0.69, 0.7, 0.72, 0.7, 0.71, 0.69].map((sim, i) => ({ id: `n${i}`, sim }))
  ];
  const levels = sparkSemanticLevels(spread);
  assert.equal(levels.get('a'), 'strong');
  assert.equal(levels.get('b'), 'some');
  assert.equal(levels.size, 2);
  assert.equal(sparkSemanticLevels(spread.slice(0, 4)).size, 0, 'färre än fem kandidater ⇒ ingen signal');
  assert.equal(sparkSemanticLevels(spread.map((s) => ({ ...s, sim: 0.8 }))).size, 0, 'ingen spridning');
});

test('likhet för en utgångspost, med uteslutning', () => {
  const vecs = new Map<string, number[]>([
    ['hit', [1, 0.05]],
    ['x1', [0.2, 1]],
    ['x2', [0.25, 1]],
    ['x3', [0.15, 1]],
    ['x4', [0.22, 1]],
    ['x5', [0.18, 1]]
  ]);
  assert.equal(sparkSemanticFor([1, 0], vecs).get('hit'), 'strong');
  assert.equal(sparkSemanticFor([1, 0], vecs, (id) => id === 'hit').size, 0);
  assert.equal(sparkSemanticFor(undefined, vecs).size, 0);
});

const actors = new Map([
  ['a1', { id: 'a1', sector: 'tillverkning', need_matching: 'yes' }],
  ['a2', { id: 'a2', sector: 'it_tjanster', solution_matching: 'yes' }]
]);
const need = { id: 'n1', actor: 'a1', areas: ['spillvarme'], status: 'open' };
const sol = { id: 's1', actor: 'a2', areas: ['energieffektivisering'], target_sectors: [], needs: [], status: 'active' };

test('tydlig likhet räcker för ett förslag utan gemensam kategori — med varning', () => {
  assert.equal(scoreNeedSolution(need, sol, actors), null);
  assert.equal(scoreNeedSolution(need, sol, actors, 'some'), null, 'viss likhet räcker inte ensam');
  const s = scoreNeedSolution(need, sol, actors, 'strong');
  assert.ok(s);
  assert.equal(s.score, 3);
  assert.ok(s.reasons[0].startsWith('AI:'));
  assert.ok(s.cautions.some((c) => c.includes('Varken energiområde eller bransch')));
  const ranked = rankSolutionsForNeed(need, [sol], actors, { semantic: new Map([['s1', 'strong']]) });
  assert.equal(ranked.length, 1);
});

test('likhet lägger poäng ovanpå en vanlig träff', () => {
  const same = { ...sol, areas: ['spillvarme'] };
  const base = scoreNeedSolution(need, same, actors)!;
  assert.equal(scoreNeedSolution(need, same, actors, 'some')!.score, base.score + 2);
  assert.equal(scoreNeedSolution(need, same, actors, 'strong')!.score, base.score + 3);
});

test('AI-svar tvingas in i ett förslag — aldrig en gissning', () => {
  const ok = parseSparkAssessmentSuggestion('```json\n{"trl": 5, "category": "candidate", "rationale": "Prototyp testad hos kund.", "confidence": 0.8}\n```');
  assert.deepEqual(ok, { trl: 5, category: 'candidate', rationale: 'Prototyp testad hos kund.', confidence: 0.8 });
  const str = parseSparkAssessmentSuggestion('{"trl": "7", "category": "hittepa", "rationale": "x", "confidence": 3}');
  assert.deepEqual(str, { trl: 7, category: null, rationale: 'x', confidence: 1 });
  const unsure = parseSparkAssessmentSuggestion('{"trl": null, "category": "candidate", "rationale": "Underlaget räcker inte.", "confidence": 0.9}');
  assert.deepEqual(unsure, { trl: null, category: null, rationale: 'Underlaget räcker inte.', confidence: 0.3 });
  assert.equal(parseSparkAssessmentSuggestion('{"trl": 12}'), null);
  assert.equal(parseSparkAssessmentSuggestion('inget json här'), null);
  assert.equal(extractSparkJson('[1,2]'), null);
  assert.deepEqual(parseSparkAssessmentSuggestion('{"trl": null, "category": "not_relevant", "rationale": "Ingen energikoppling."}')?.category, 'not_relevant');
});

test('introduktionsutkast rensas från kod och HTML', () => {
  assert.equal(cleanSparkIntroDraft('```\nHej!\n\n\n\n<b>Vi</b> har hittat något.\n```'), 'Hej!\n\nVi har hittat något.');
  assert.equal(cleanSparkIntroDraft('x'.repeat(5000)).length, 2500);
});
