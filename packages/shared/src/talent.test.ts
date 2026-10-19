import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anonymizeStudent,
  canTransitionInterest,
  canTransitionNeed,
  cleanTalentText,
  interestRevealsContact,
  isStudentProfileExpired,
  publicCompanyLabel,
  rankNeedsForStudent,
  rankStudentsForNeed,
  sanitizeNeedTags,
  sanitizeStudentTags,
  scoreTalentPair,
  studentProfileExpiresAt,
  uncoveredNeedTags,
  validateStudentProfileInput,
  validateTalentNeedInput,
  type RankableNeed,
  type RankableStudent
} from './talent';

const need: RankableNeed = {
  id: 'need1',
  kind: 'exjobb',
  tags: ['react', 'typescript', 'ux'],
  starts_at: '2027-01-15',
  ends_at: '2027-06-15',
  location: 'Gävle',
  work_mode: 'hybrid',
  status: 'published'
};

const student = (over: Partial<RankableStudent>): RankableStudent => ({
  id: 's',
  tags: [],
  seeking: ['exjobb'],
  available_from: '2027-01-01',
  location: 'Gävle',
  remote_ok: false,
  searchable: true,
  status: 'active',
  ...over
});

test('validateTalentNeedInput: kräver rubrik, typ, beskrivning och taggar; städar fritext', () => {
  const bad = validateTalentNeedInput({ title: 'Ex', kind: 'exjobb' });
  assert.equal(bad.ok, false);
  const ok = validateTalentNeedInput({
    title: '  Exjobb inom UX  ',
    kind: 'exjobb',
    description: 'Vi söker en student som vill göra sitt examensarbete hos oss 19900101-1234.',
    tags: '#React, TypeScript, ux, react',
    starts_at: '2027-01-15',
    ends_at: '2027-06-15',
    supervisor: 'on',
    anonymous: false
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.title, 'Exjobb inom UX');
  assert.deepEqual(ok.value.tags, ['react', 'typescript', 'ux']);
  assert.ok(ok.value.description.includes('[REDACTED]'));
  assert.equal(ok.value.supervisor, true);
  assert.equal(ok.value.compensation, 'negotiable');
  const wrongPeriod = validateTalentNeedInput({ ...ok.value, ends_at: '2026-01-01' });
  assert.equal(wrongPeriod.ok, false);
});

test('validateStudentProfileInput: e-post, nivå, taggar och vad hen söker krävs; LinkedIn måste vara https', () => {
  const base = {
    first_name: 'Anna',
    last_name: 'Svensson',
    email: 'Anna@Example.COM ',
    university: 'Högskolan i Gävle',
    program: 'Datavetenskap',
    level: 'master',
    graduation_year: '2027',
    tags: [{ tag: 'React', level: 'strong' }, { tag: 'sql', level: 'nope' }],
    seeking: ['exjobb', 'exjobb', 'okänt'],
    linkedin_url: 'https://www.linkedin.com/in/anna'
  };
  const ok = validateStudentProfileInput(base);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.email, 'anna@example.com');
  assert.deepEqual(ok.value.tags, [
    { tag: 'react', level: 'strong' },
    { tag: 'sql', level: 'contribute' }
  ]);
  assert.deepEqual(ok.value.seeking, ['exjobb']);
  assert.equal(ok.value.graduation_year, 2027);
  assert.equal(validateStudentProfileInput({ ...base, email: 'nope' }).ok, false);
  assert.equal(validateStudentProfileInput({ ...base, linkedin_url: 'http://x' }).ok, false);
  assert.equal(validateStudentProfileInput({ ...base, tags: [] }).ok, false);
});

test('sanitize: personnummer-mönster avvisas i taggar, kontrolltecken strippas i text', () => {
  assert.deepEqual(sanitizeNeedTags(['19900101-1234', 'Node JS']), ['node-js']);
  assert.deepEqual(sanitizeStudentTags(['#Figma']), [{ tag: 'figma', level: 'contribute' }]);
  assert.equal(cleanTalentText('hej\u0000 där', 10), 'hej där');
});

test('scoreTalentPair: hashtag-träff viktas med nivå, typ och period ger poäng, skälen är läsbara', () => {
  const strong = student({ id: 'a', tags: [{ tag: 'react', level: 'expert' }, { tag: 'ux', level: 'contribute' }] });
  const weak = student({ id: 'b', tags: [{ tag: 'react', level: 'contribute' }] });
  const a = scoreTalentPair(need, strong);
  const b = scoreTalentPair(need, weak);
  assert.ok(a.score > b.score);
  assert.deepEqual(a.matchedTags, ['react', 'ux']);
  assert.deepEqual(a.missingTags, ['typescript']);
  assert.ok(a.reasons.includes('2 av 3 hashtags'));
  assert.ok(a.reasons.includes('söker examensarbete'));
  assert.ok(a.reasons.includes('tillgänglig från start'));
  assert.ok(a.reasons.includes('samma ort'));
});

test('rankStudentsForNeed: bara aktiva + sökbara, minst en träff, sorterat fallande, exkluderar redan föreslagna', () => {
  const list = [
    student({ id: 'paused', status: 'paused', tags: [{ tag: 'react', level: 'expert' }] }),
    student({ id: 'hidden', searchable: false, tags: [{ tag: 'react', level: 'expert' }] }),
    student({ id: 'none', tags: [{ tag: 'java', level: 'expert' }], seeking: ['praktik'] }),
    student({ id: 'good', tags: [{ tag: 'react', level: 'strong' }, { tag: 'typescript', level: 'strong' }] }),
    student({ id: 'okish', tags: [{ tag: 'ux', level: 'contribute' }] }),
    student({ id: 'already', tags: [{ tag: 'react', level: 'expert' }] })
  ];
  const ranked = rankStudentsForNeed(need, list, { exclude: new Set(['already']) });
  assert.deepEqual(
    ranked.map((r) => r.item.id),
    ['good', 'okish']
  );
});

test('rankNeedsForStudent: bara publicerade behov', () => {
  const s = student({ id: 'x', tags: [{ tag: 'react', level: 'strong' }] });
  const ranked = rankNeedsForStudent(s, [need, { ...need, id: 'draft', status: 'draft' }]);
  assert.deepEqual(ranked.map((r) => r.item.id), ['need1']);
});

test('uncoveredNeedTags: taggar ingen sökbar student har', () => {
  assert.deepEqual(uncoveredNeedTags(need, [student({ tags: [{ tag: 'react', level: 'strong' }] })]), ['typescript', 'ux']);
});

test('statusövergångar: studenten styr förslag och tillbakadragande, bolaget dialog/match, Movexum allt', () => {
  assert.equal(canTransitionInterest('proposed', 'new', 'student'), true);
  assert.equal(canTransitionInterest('proposed', 'declined', 'student'), true);
  assert.equal(canTransitionInterest('proposed', 'new', 'company'), false);
  assert.equal(canTransitionInterest('new', 'dialogue', 'company'), true);
  assert.equal(canTransitionInterest('new', 'matched', 'student'), false);
  assert.equal(canTransitionInterest('new', 'withdrawn', 'student'), true);
  assert.equal(canTransitionInterest('declined', 'new', 'staff'), true);
  assert.equal(canTransitionInterest('declined', 'new', 'company'), false);
  assert.equal(canTransitionInterest('new', 'withdrawn', 'staff'), false);
  assert.equal(interestRevealsContact('proposed'), false);
  assert.equal(interestRevealsContact('new'), true);
});

test('behovets statusbyten: bolaget kan aldrig publicera själv', () => {
  assert.equal(canTransitionNeed('draft', 'pending_review', 'company'), true);
  assert.equal(canTransitionNeed('draft', 'published', 'company'), false);
  assert.equal(canTransitionNeed('pending_review', 'published', 'staff'), true);
  assert.equal(canTransitionNeed('published', 'paused', 'company'), true);
  assert.equal(canTransitionNeed('paused', 'published', 'company'), true);
});

test('gallring: samtycket gäller ett år', () => {
  const consent = new Date('2026-10-19T10:00:00Z');
  const exp = studentProfileExpiresAt(consent);
  assert.equal(exp.toISOString().slice(0, 10), '2027-10-19');
  assert.equal(isStudentProfileExpired(exp, new Date('2027-10-18T00:00:00Z')), false);
  assert.equal(isStudentProfileExpired(exp, new Date('2027-10-20T00:00:00Z')), true);
});

test('anonymizeStudent bär aldrig namn eller e-post; publicCompanyLabel döljer anonyma bolag', () => {
  const a = anonymizeStudent({
    id: 'p',
    level: 'master',
    university: 'HiG',
    program: 'Datavetenskap',
    graduation_year: 2027,
    tags: [],
    seeking: ['exjobb'],
    available_from: null,
    location: '',
    remote_ok: true,
    summary: 'Gillar frontend.'
  });
  assert.equal(a.headline, 'Datavetenskap · HiG');
  assert.ok(!('email' in a) && !('first_name' in a));
  assert.equal(publicCompanyLabel({ anonymous: true }, 'Fixkod AB', 'Movexum'), 'Startup i Movexums inkubator');
  assert.equal(publicCompanyLabel({ anonymous: false }, 'Fixkod AB'), 'Fixkod AB');
});
