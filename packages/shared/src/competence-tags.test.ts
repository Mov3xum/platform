import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPETENCE_TAG_SEED,
  competenceCoverageGaps,
  competenceProfileStatus,
  computeTeamLoads,
  computeTeamMerits,
  describeMerit,
  deriveCompetenceAreas,
  inferTeamNeedFromText,
  loadLevel,
  mergeCompetenceTagVocabulary,
  normalizeCompetenceTagSlug,
  rankTeamCandidates,
  sanitizeCompetenceTagLabel,
  sanitizeDevelopmentInterests,
  sanitizeNeededTags,
  sanitizeTeamNeed,
  summarizeCompetenceCoverage,
  sanitizeUserCompetenceTags,
  teamNeedGaps,
  uncoveredNeededTags,
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

test('computeTeamMerits: bara avslutade team, relevant vid tagg-överlapp, en gång per person', () => {
  const merits = computeTeamMerits(
    [
      { status: 'done', issuer: 'anna', recipients: ['bo'], participants_json: [{ user_id: 'anna', role: 'lead' }], needed_tags: ['vinnova-ansokan', 'eic'] },
      { status: 'done', issuer: 'bo', participants_json: [{ user_id: 'cia', role: 'contributor' }], needed_tags: ['linkedin'] },
      { status: 'in_progress', issuer: 'anna', needed_tags: ['vinnova-ansokan'] },
      { status: 'done', issuer: 'dan', needed_tags: 'inte-en-lista' }
    ],
    ['vinnova-ansokan']
  );
  assert.deepEqual(merits.get('anna'), { completed: 1, relevant: 1 });
  assert.deepEqual(merits.get('bo'), { completed: 2, relevant: 1 });
  assert.deepEqual(merits.get('cia'), { completed: 1, relevant: 0 });
  assert.deepEqual(merits.get('dan'), { completed: 1, relevant: 0 });
  assert.equal(describeMerit({ completed: 0, relevant: 0 }), null);
  assert.equal(describeMerit({ completed: 2, relevant: 1 }), '2 avslutade team, 1 med liknande behov');
});

test('rankTeamCandidates: meriter höjer poängen lätt och syns som skäl', () => {
  const base: RankableCandidate = {
    id: 'a',
    name: 'A',
    tags: [{ tag: 'eic', area: 'finansiering_kapital', level: 'strong' }],
    load: { active: 0, leading: 0 }
  };
  const [withMerit, without] = rankTeamCandidates({ areas: [], tags: ['eic'] }, [
    { ...base, id: 'm', name: 'M', merit: { completed: 10, relevant: 10 } },
    base
  ]);
  assert.equal(withMerit.id, 'm');
  // Taket: 3 × 0,75 + 5 × 0,15 = 3 poäng mer, inte 10 × …
  assert.equal(Math.round((withMerit.score - without.score) * 100) / 100, 3);
  assert.ok(withMerit.reasons.includes('10 avslutade team, 10 med liknande behov'));
});

test('sanitizeNeededTags: slugs, unika, tak 12', () => {
  assert.deepEqual(sanitizeNeededTags(['#EIC', 'eic', 'Term Sheet', 7]), ['eic', 'term-sheet']);
  assert.equal(sanitizeNeededTags(Array.from({ length: 20 }, (_, i) => `x${i}`)).length, 12);
});

test('summarizeCompetenceCoverage: personer, nivåer, lärande och egna taggar utanför vokabulären', () => {
  const coverage = summarizeCompetenceCoverage(
    [
      { id: '1', name: 'A', tags: [{ tag: 'eic', area: 'finansiering_kapital', level: 'expert' }] },
      { id: '2', name: 'B', tags: [{ tag: 'eic', area: 'finansiering_kapital', level: 'contribute' }, { tag: 'egen-tagg', area: 'annat', level: 'strong' }], developmentInterests: ['medtech'] },
      { id: '3', name: 'C', tags: [], developmentInterests: ['eic'] }
    ],
    COMPETENCE_TAG_SEED
  );
  const eic = coverage.find((r) => r.slug === 'eic')!;
  assert.equal(eic.people, 2);
  assert.deepEqual(eic.byLevel, { contribute: 1, strong: 0, expert: 1 });
  assert.equal(eic.maxLevel, 'expert');
  assert.equal(eic.learners, 1);
  assert.equal(coverage.find((r) => r.slug === 'medtech')?.learners, 1);
  const egen = coverage.find((r) => r.slug === 'egen-tagg')!;
  assert.equal(egen.people, 1);
  assert.equal(egen.area, 'annat');
  const gaps = competenceCoverageGaps(coverage);
  assert.ok(gaps.some((g) => g.area === 'juridik' && g.tags.some((t) => t.slug === 'gdpr')));
  assert.ok(!gaps.some((g) => g.tags.some((t) => t.slug === 'eic')));
  const needed = uncoveredNeededTags(
    [
      { status: 'done', needed_tags: ['gdpr', 'eic'] },
      { status: 'in_progress', needed_tags: ['gdpr'] }
    ],
    coverage
  );
  assert.deepEqual(needed, [{ slug: 'gdpr', missions: 2 }]);
});

test('competenceProfileStatus: saknas / inaktuell / aktuell / okänt datum', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  assert.equal(competenceProfileStatus(null, false, now), 'missing');
  assert.equal(competenceProfileStatus(null, true, now), 'unknown');
  assert.equal(competenceProfileStatus('skräp', true, now), 'unknown');
  assert.equal(competenceProfileStatus('2026-09-01T00:00:00Z', true, now), 'fresh');
  assert.equal(competenceProfileStatus('2026-03-01T00:00:00Z', true, now), 'stale');
});
