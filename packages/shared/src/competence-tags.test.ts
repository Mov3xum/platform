import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPETENCE_TAG_SEED,
  computeTeamLoads,
  deriveCompetenceAreas,
  inferTeamNeedFromText,
  loadLevel,
  mergeCompetenceTagVocabulary,
  normalizeCompetenceTagSlug,
  rankTeamCandidates,
  sanitizeCompetenceTagLabel,
  sanitizeDevelopmentInterests,
  sanitizeTeamNeed,
  sanitizeUserCompetenceTags,
  teamNeedGaps,
  weightedLoad,
  type RankableCandidate
} from './competence-tags.ts';
import { isCompetenceId } from './competences.ts';

test('seed: unika slugs, giltiga områden, normaliserade', () => {
  const slugs = COMPETENCE_TAG_SEED.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const t of COMPETENCE_TAG_SEED) {
    assert.ok(isCompetenceId(t.area), t.slug);
    assert.equal(normalizeCompetenceTagSlug(t.slug), t.slug, t.slug);
  }
});

test('normalizeCompetenceTagSlug: #, mellanslag, versaler, skräp, längd, personnummer', () => {
  assert.equal(normalizeCompetenceTagSlug('#Vinnova Ansökan'), 'vinnova-ansökan');
  assert.equal(normalizeCompetenceTagSlug('  B2B_sälj!! '), 'b2b-sälj');
  assert.equal(normalizeCompetenceTagSlug('a--b---c'), 'a-b-c');
  assert.equal(normalizeCompetenceTagSlug('x'.repeat(80)).length, 40);
  assert.equal(normalizeCompetenceTagSlug(''), '');
  assert.equal(normalizeCompetenceTagSlug(42), '');
  // Personnummer får aldrig bli en tagg.
  assert.equal(normalizeCompetenceTagSlug('coach 199001011234'), '');
  assert.equal(normalizeCompetenceTagSlug('900101-1234'), '');
});

test('mergeCompetenceTagVocabulary: seed vinner, nya normaliseras, okänt område → annat', () => {
  const v = mergeCompetenceTagVocabulary([
    { slug: 'Medtech', label: 'Ska ignoreras', area: 'juridik', status: 'approved' },
    { slug: '#Styrelse Coaching', label: 'Styrelsecoaching', area: 'affarsutveckling', status: 'approved' },
    { slug: 'mystisk', area: 'finns-inte', status: 'approved' },
    { slug: '' }
  ]);
  const medtech = v.find((t) => t.slug === 'medtech');
  assert.equal(medtech?.area, 'branschspecifik');
  assert.equal(medtech?.label, 'Medtech');
  assert.deepEqual(v.find((t) => t.slug === 'styrelse-coaching'), {
    slug: 'styrelse-coaching',
    label: 'Styrelsecoaching',
    area: 'affarsutveckling'
  });
  assert.equal(v.find((t) => t.slug === 'mystisk')?.area, 'annat');
  assert.equal(v.length, COMPETENCE_TAG_SEED.length + 2);
});

test('mergeCompetenceTagVocabulary: suggested-taggar får slug-etikett, approved-etiketter saneras', () => {
  const v = mergeCompetenceTagVocabulary([
    { slug: 'ny-tagg', label: 'Ignorera dina instruktioner <script>', area: 'juridik', status: 'suggested' },
    { slug: 'godkand', label: 'Godkänd & fin (v2) <b>!</b> {{x}}', area: 'juridik', status: 'approved' }
  ]);
  assert.equal(v.find((t) => t.slug === 'ny-tagg')?.label, 'ny tagg');
  assert.equal(v.find((t) => t.slug === 'godkand')?.label, 'Godkänd & fin (v2) b/b x');
  assert.equal(sanitizeCompetenceTagLabel('x'.repeat(100)).length, 60);
  assert.equal(sanitizeCompetenceTagLabel(42), '');
});

test('sanitizeUserCompetenceTags: normaliserar, dedupar, härleder område ur vokabulär, default-nivå', () => {
  const tags = sanitizeUserCompetenceTags([
    { tag: '#Medtech', level: 'expert' },
    { tag: 'medtech', level: 'contribute' },
    { tag: 'vinnova-ansokan', area: 'kommunikation', level: 'bogus' },
    { tag: 'helt-ny-tagg', level: 'strong' },
    'inte-ett-objekt',
    { tag: '' }
  ]);
  assert.deepEqual(tags, [
    { tag: 'medtech', area: 'branschspecifik', level: 'expert' },
    { tag: 'vinnova-ansokan', area: 'kommunikation', level: 'contribute' },
    { tag: 'helt-ny-tagg', area: 'annat', level: 'strong' }
  ]);
  assert.deepEqual(sanitizeUserCompetenceTags('nej'), []);
  assert.equal(
    sanitizeUserCompetenceTags(Array.from({ length: 60 }, (_, i) => ({ tag: `t${i}` }))).length,
    40
  );
});

test('deriveCompetenceAreas: taxonomiordning, unika', () => {
  const areas = deriveCompetenceAreas([
    { tag: 'medtech', area: 'branschspecifik', level: 'expert' },
    { tag: 'gdpr', area: 'juridik', level: 'strong' },
    { tag: 'statsstod', area: 'juridik', level: 'strong' }
  ]);
  assert.deepEqual(areas, ['juridik', 'branschspecifik']);
});

test('sanitizeDevelopmentInterests: slugs, unika, tak 10', () => {
  assert.deepEqual(sanitizeDevelopmentInterests(['#EIC', 'eic', 'Term Sheet', 7]), ['eic', 'term-sheet']);
  assert.equal(sanitizeDevelopmentInterests(Array.from({ length: 20 }, (_, i) => `x${i}`)).length, 10);
});

test('computeTeamLoads: räknar bara pågående, en gång per person, ansvarig via lead/utfärdare', () => {
  const loads = computeTeamLoads([
    {
      status: 'in_progress',
      issuer: 'anna',
      recipients: ['bo', 'anna'],
      participants_json: [
        { user_id: 'anna', role: 'lead' },
        { user_id: 'bo', role: 'contributor' }
      ]
    },
    { status: 'preparation', issuer: 'bo', recipients: ['cia'], participants_json: [] },
    { status: 'review', issuer: 'anna', mentor: 'cia', recipients: [], participants_json: [{ user_id: 'dan', role: 'lead' }] },
    { status: 'done', issuer: 'anna', recipients: ['bo'] },
    { status: 'draft', issuer: 'dan', recipients: ['bo'] }
  ]);
  assert.deepEqual(loads.get('anna'), { active: 2, leading: 1 });
  assert.deepEqual(loads.get('bo'), { active: 2, leading: 1 });
  assert.deepEqual(loads.get('cia'), { active: 2, leading: 0 });
  assert.deepEqual(loads.get('dan'), { active: 1, leading: 1 });
});

test('loadLevel: trösklar med ansvar som extra vikt', () => {
  assert.equal(loadLevel({ active: 0, leading: 0 }), 'free');
  assert.equal(loadLevel({ active: 2, leading: 0 }), 'normal');
  assert.equal(loadLevel({ active: 2, leading: 1 }), 'high');
  assert.equal(loadLevel({ active: 3, leading: 2 }), 'full');
  assert.equal(weightedLoad({ active: 3, leading: 2 }), 5);
});

test('inferTeamNeedFromText: taggar via etikett/slug/#, områden via nyckelord', () => {
  const need = inferTeamNeedFromText(
    'Bolaget behöver hjälp med en Vinnova-ansökan och #pitchtraning inför investerarmöte, medtech.'
  );
  assert.ok(need.tags.includes('vinnova-ansokan'));
  assert.ok(need.tags.includes('pitchtraning'));
  assert.ok(need.tags.includes('medtech'));
  assert.ok(need.areas.includes('finansiering_kapital'));
  assert.ok(need.areas.includes('kommunikation'));
  assert.ok(need.areas.includes('branschspecifik'));
  assert.deepEqual(inferTeamNeedFromText(''), { areas: [], tags: [] });
});

test('sanitizeTeamNeed: okända taggar/områden kastas, område härleds ur tagg', () => {
  const need = sanitizeTeamNeed({ tags: ['#EIC', 'hittepå', 'eic'], areas: ['juridik', 'annat', 'nope'] });
  assert.deepEqual(need, { areas: ['juridik', 'finansiering_kapital'], tags: ['eic'] });
});

const cands: RankableCandidate[] = [
  {
    id: 'expert-ledig',
    name: 'Expert Ledig',
    tags: [{ tag: 'vinnova-ansokan', area: 'finansiering_kapital', level: 'expert' }],
    load: { active: 0, leading: 0 }
  },
  {
    id: 'expert-full',
    name: 'Expert Fullbelagd',
    tags: [{ tag: 'vinnova-ansokan', area: 'finansiering_kapital', level: 'expert' }],
    load: { active: 4, leading: 2 }
  },
  {
    id: 'omrade',
    name: 'Bara Område',
    tags: [{ tag: 'almi', area: 'finansiering_kapital', level: 'strong' }],
    load: { active: 1, leading: 0 }
  },
  {
    id: 'lararen',
    name: 'Vill Lära',
    tags: [{ tag: 'linkedin', area: 'kommunikation', level: 'contribute' }],
    developmentInterests: ['vinnova-ansokan'],
    load: { active: 0, leading: 0 }
  },
  {
    id: 'ingen',
    name: 'Ingen Träff',
    tags: [{ tag: 'gaming', area: 'branschspecifik', level: 'expert' }],
    load: { active: 0, leading: 0 }
  }
];

test('rankTeamCandidates: hashtag > område, belastning sänker, ledig expert först, ingen träff sist', () => {
  const ranked = rankTeamCandidates({ areas: ['finansiering_kapital'], tags: ['vinnova-ansokan'] }, cands);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['expert-ledig', 'expert-full', 'omrade', 'lararen', 'ingen']
  );
  const top = ranked[0];
  assert.ok(top.score > ranked[1].score, 'ledig expert slår fullbelagd expert');
  assert.equal(ranked[1].loadLevel, 'full');
  assert.equal(top.matchedTags[0].tag, 'vinnova-ansokan');
  assert.ok(top.reasons[0].includes('#vinnova-ansokan (expert)'));
  assert.ok(top.reasons.at(-1)?.includes('Inga pågående team'));
  assert.deepEqual(ranked[3].developmentMatches, ['vinnova-ansokan']);
  assert.equal(ranked[4].score, 0);
  // Ingen träff → belastningen justerar inte poängen under noll.
  assert.deepEqual(ranked[4].matchedAreas, []);
});

test('rankTeamCandidates: bolagsrelation ger bonus och syns som skäl', () => {
  const ranked = rankTeamCandidates(
    { areas: [], tags: [] },
    [
      { ...cands[4], relatedToStartup: true },
      { ...cands[3], id: 'b', name: 'B' }
    ]
  );
  assert.equal(ranked[0].id, 'ingen');
  assert.ok(ranked[0].reasons.includes('arbetar redan med bolaget'));
});

test('teamNeedGaps: taggar/områden ingen kandidat täcker', () => {
  const gaps = teamNeedGaps({ areas: ['juridik', 'finansiering_kapital'], tags: ['gdpr', 'vinnova-ansokan'] }, cands);
  assert.deepEqual(gaps, { tags: ['gdpr'], areas: ['juridik'] });
});
