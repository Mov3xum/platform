import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPASS_UI,
  applyCompassModuleTranslation,
  applyCompassQuestionTranslation,
  buildStoredCompassTranslation,
  compassSourceHash,
  compassTranslatableEntries,
  compassTranslationEntryState,
  hasPublishedEnglish,
  normalizeCompassTranslations,
  parseCompassLocale,
  publishedEnglishTexts,
  summarizeCompassTranslation,
  translateResultBucket
} from './compass-i18n.ts';
import { missingContactField, CONTACT_SECTION_DEFAULT, contactOptionText } from './compass-contact.ts';

const module = {
  name: 'Idébeskrivning',
  welcome_title: 'Berätta om din idé',
  welcome_body: 'Det tar fem minuter.',
  consent_note: 'Vi sparar dina svar.',
  hero_eyebrow: '',
  result_buckets: [
    { key: 'tidig', title: 'Tidig fas', body: 'Du är i början.', tips: ['Prata med kunder'], cta: { label: 'Boka möte', url: '/m/x' } }
  ]
};
const questions = [
  {
    id: 'q1',
    key: 'idea',
    prompt: 'Vad är idén?',
    help_text: 'Kort',
    choices: [
      { value: 'a', label: 'Produkt' },
      { value: 'b', label: 'Tjänst' }
    ]
  },
  { id: 'q2', key: 'name', prompt: 'Vad heter du?', help_text: '' }
];

test('parseCompassLocale: bara "en" ger engelska', () => {
  assert.equal(parseCompassLocale('en'), 'en');
  assert.equal(parseCompassLocale(' EN '), 'en');
  assert.equal(parseCompassLocale(['en']), 'en');
  assert.equal(parseCompassLocale('sv'), 'sv');
  assert.equal(parseCompassLocale('de'), 'sv');
  assert.equal(parseCompassLocale(undefined), 'sv');
});

test('compassTranslatableEntries: stabila nycklar, tomma källor hoppas över', () => {
  const keys = compassTranslatableEntries(module, questions).map((e) => e.key);
  assert.ok(keys.includes('m.welcome_title'));
  assert.ok(keys.includes('m.name'));
  assert.ok(!keys.includes('m.hero_eyebrow'), 'tom källa ska inte listas');
  assert.ok(keys.includes('q.q1.prompt'));
  assert.ok(keys.includes('q.q1.help'));
  assert.ok(!keys.includes('q.q2.help'));
  assert.ok(keys.includes('q.q1.c.a'));
  assert.ok(keys.includes('b.tidig.title'));
  assert.ok(keys.includes('b.tidig.tip.0'));
  assert.ok(keys.includes('b.tidig.cta'));
});

test('apply: översatta texter ersätter, saknade faller tillbaka på svenska, värden orörda', () => {
  const texts = { 'm.welcome_title': 'Tell us about your idea', 'q.q1.prompt': 'What is the idea?', 'q.q1.c.a': 'Product' };
  const m = applyCompassModuleTranslation(module, texts);
  assert.equal(m.welcome_title, 'Tell us about your idea');
  assert.equal(m.welcome_body, 'Det tar fem minuter.');
  const q = applyCompassQuestionTranslation(questions, texts);
  assert.equal(q[0].prompt, 'What is the idea?');
  assert.equal(q[0].help_text, 'Kort');
  assert.deepEqual(q[0].choices?.map((c) => c.value), ['a', 'b']);
  assert.deepEqual(q[0].choices?.map((c) => c.label), ['Product', 'Tjänst']);
  assert.equal(q[1].prompt, 'Vad heter du?');
});

test('translateResultBucket: nyckel/länk orörda', () => {
  const b = translateResultBucket(module.result_buckets[0], {
    'b.tidig.title': 'Early stage',
    'b.tidig.tip.0': 'Talk to customers',
    'b.tidig.cta': 'Book a meeting'
  });
  assert.equal(b.key, 'tidig');
  assert.equal(b.title, 'Early stage');
  assert.equal(b.body, 'Du är i början.');
  assert.deepEqual(b.tips, ['Talk to customers']);
  assert.deepEqual(b.cta, { label: 'Book a meeting', url: '/m/x' });
  assert.equal(translateResultBucket(null, {}), null);
});

test('build + state: källändring markeras, borttagna nycklar rensas', () => {
  const entries = compassTranslatableEntries(module, questions);
  const stored = buildStoredCompassTranslation(
    entries,
    { 'm.welcome_title': '  Tell us  ', 'q.gone.prompt': 'Old', 'm.name': '' },
    { enabled: true }
  );
  assert.deepEqual(Object.keys(stored.texts), ['m.welcome_title']);
  assert.equal(stored.texts['m.welcome_title'], 'Tell us');
  assert.equal(stored.enabled, true);
  const title = entries.find((e) => e.key === 'm.welcome_title')!;
  assert.equal(compassTranslationEntryState(title, stored), 'ok');
  assert.equal(compassTranslationEntryState({ ...title, source: 'Ny svensk rubrik' }, stored), 'stale');
  const body = entries.find((e) => e.key === 'm.welcome_body')!;
  assert.equal(compassTranslationEntryState(body, stored), 'missing');
  const sum = summarizeCompassTranslation(entries, stored);
  assert.equal(sum.translated, 1);
  assert.equal(sum.missing, entries.length - 1);
});

test('publicering kräver minst en text', () => {
  const stored = buildStoredCompassTranslation([], {}, { enabled: true });
  assert.equal(stored.enabled, false);
});

test('normalize: tolerant mot skräp, publiceringsgrinden', () => {
  assert.deepEqual(normalizeCompassTranslations(null), {});
  assert.deepEqual(normalizeCompassTranslations('inte json'), {});
  const raw = {
    en: {
      enabled: true,
      texts: { 'm.name': 'Idea', 'bad key': 'x', 'q.q1.prompt': 42 },
      sources: { 'm.name': compassSourceHash('Idébeskrivning'), 'm.x': 'ZZZ' }
    }
  };
  const n = normalizeCompassTranslations(raw);
  assert.deepEqual(n.en?.texts, { 'm.name': 'Idea' });
  assert.deepEqual(Object.keys(n.en?.sources ?? {}), ['m.name']);
  assert.equal(hasPublishedEnglish(raw), true);
  assert.equal(hasPublishedEnglish({ en: { enabled: false, texts: { 'm.name': 'Idea' } } }), false);
  assert.equal(hasPublishedEnglish({ en: { enabled: true, texts: {} } }), false);
  assert.deepEqual(publishedEnglishTexts(raw, 'en'), { 'm.name': 'Idea' });
  assert.equal(publishedEnglishTexts(raw, 'sv'), null);
  assert.equal(publishedEnglishTexts({ en: { enabled: false, texts: { 'm.name': 'Idea' } } }, 'en'), null);
});

test('compassSourceHash är deterministisk', () => {
  assert.equal(compassSourceHash('abc'), compassSourceHash('abc'));
  assert.notEqual(compassSourceHash('abc'), compassSourceHash('abd'));
  assert.match(compassSourceHash('Hej på dig'), /^[0-9a-f]{8}$/);
});

test('UI-ordböckerna har samma nycklar', () => {
  assert.deepEqual(Object.keys(COMPASS_UI.en).sort(), Object.keys(COMPASS_UI.sv).sort());
  assert.equal(COMPASS_UI.en.questionOf(2, 5), 'Question 2 of 5');
});

test('kontaktavsnittet på engelska', () => {
  assert.equal(missingContactField({}, CONTACT_SECTION_DEFAULT, 'en'), 'Name of the idea owner is required.');
  assert.equal(missingContactField({}, CONTACT_SECTION_DEFAULT), 'Namn på idéägaren krävs.');
  assert.equal(contactOptionText({ value: 'vill_inte_ange', label: 'Vill inte ange' }, 'en'), 'Prefer not to say');
  assert.equal(contactOptionText({ value: 'gavle', label: 'Gävle' }, 'en'), 'Gävle');
});
