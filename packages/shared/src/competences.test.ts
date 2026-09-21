import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPETENCES,
  COMPETENCE_IDS,
  DEFAULT_COMPETENCE,
  isCompetenceId,
  resolveCompetence,
  sanitizeCompetences,
  inferCompetencesFromText
} from './competences';

describe('competences taxonomy', () => {
  it('has unique ids and the default is present', () => {
    const ids = COMPETENCES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
    assert.ok(COMPETENCE_IDS.includes(DEFAULT_COMPETENCE));
  });

  it('isCompetenceId validates membership', () => {
    assert.equal(isCompetenceId('projektledning'), true);
    assert.equal(isCompetenceId('not_a_competence'), false);
    assert.equal(isCompetenceId(42), false);
  });

  it('resolveCompetence falls back to default for invalid input', () => {
    assert.equal(resolveCompetence('juridik'), 'juridik');
    assert.equal(resolveCompetence('nonsense'), DEFAULT_COMPETENCE);
    assert.equal(resolveCompetence(undefined), DEFAULT_COMPETENCE);
  });

  it('sanitizeCompetences keeps valid+unique ids in taxonomy order', () => {
    const out = sanitizeCompetences(['juridik', 'affarscoaching', 'juridik', 'bad']);
    assert.deepEqual(out, ['affarscoaching', 'juridik']);
    assert.deepEqual(sanitizeCompetences('nope'), []);
    assert.deepEqual(sanitizeCompetences(null), []);
  });

  it('inferCompetencesFromText maps free-text skills via keywords/labels', () => {
    assert.deepEqual(
      inferCompetencesFromText('Erfaren affärscoach och projektledare'),
      ['affarscoaching', 'projektledning']
    );
    // keyword match (HR + Sobona) and case-insensitivity
    assert.deepEqual(inferCompetencesFromText('HR, skyddsombud, Sobona'), ['hr_personal']);
    assert.deepEqual(inferCompetencesFromText(''), []);
    assert.deepEqual(inferCompetencesFromText(null), []);
  });
});
