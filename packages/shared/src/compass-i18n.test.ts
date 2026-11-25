import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPASS_UI,
  applyCompassModuleTranslation,
  applyCompassQuestionTranslation,
  compassEntriesToTranslate,
  mergeCompassTranslation,
  compassSourceHash,
  compassTranslatableEntries,
  compassTranslationEntryState,
  normalizeCompassTranslations,
  parseCompassLocale,
  storedEnglishTexts,
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

test('merge + state: källändring översätts om, borttagna nycklar rensas', () => {
  const entries = compassTranslatableEntries(module, questions);
  const stored = mergeCompassTranslation(entries, undefined, {
    'm.welcome_title': '  Tell us  ',
    'q.gone.prompt': 'Old',
    'm.name': ''
  });
  assert.deepEqual(Object.keys(stored.texts), ['m.welcome_title']);
  assert.equal(stored.texts['m.welcome_title'], 'Tell us');
  const title = entries.find((e) => e.key === 'm.welcome_title')!;
  assert.equal(compassTranslationEntryState(title, stored), 'ok');
  assert.equal(compassTranslationEntryState({ ...title, source: 'Ny svensk rubrik' }, stored), 'stale');
  const body = entries.find((e) => e.key === 'm.welcome_body')!;
  assert.equal(compassTranslationEntryState(body, stored), 'missing');
  assert.equal(compassEntriesToTranslate(entries, stored).length, entries.length - 1);
  assert.equal(compassEntriesToTranslate(entries, undefined).length, entries.length);
});

test('merge: en text som inte översattes nu behåller sin gamla hash (förblir stale)', () => {
  const entries = compassTranslatableEntries(module, questions);
  const first = mergeCompassTranslation(entries, undefined, { 'm.welcome_title': 'Tell us', 'm.name': 'Idea' });
  // Svenskan ändras; nästa körning översätter bara namnet.
  const changed = entries.map((e) => (e.key === 'm.welcome_title' ? { ...e, source: 'Ny rubrik' } : e));
  const second = mergeCompassTranslation(changed, first, { 'm.name': 'Idea description' });
  assert.equal(second.texts['m.name'], 'Idea description');
  assert.equal(second.texts['m.welcome_title'], 'Tell us', 'äldre engelska visas under tiden');
  const title = changed.find((e) => e.key === 'm.welcome_title')!;
  assert.equal(compassTranslationEntryState(title, second), 'stale');
  assert.deepEqual(
    compassEntriesToTranslate(changed, second).map((e) => e.key).includes('m.welcome_title'),
    true
  );
  // När den översatts är allt klart.
  const third = mergeCompassTranslation(changed, second, { 'm.welcome_title': 'New title' });
  assert.equal(compassTranslationEntryState(title, third), 'ok');
});

test('normalize: tolerant mot skräp; äldre format med enabled läses', () => {
  assert.deepEqual(normalizeCompassTranslations(null), {});
  assert.deepEqual(normalizeCompassTranslations('inte json'), {});
  const raw = {
    en: {
      enabled: false,
      texts: { 'm.name': 'Idea', 'bad key': 'x', 'q.q1.prompt': 42 },
      sources: { 'm.name': compassSourceHash('Idébeskrivning'), 'm.x': 'ZZZ' }
    }
  };
  const n = normalizeCompassTranslations(raw);
  assert.deepEqual(n.en?.texts, { 'm.name': 'Idea' });
  assert.deepEqual(Object.keys(n.en?.sources ?? {}), ['m.name']);
  assert.deepEqual(storedEnglishTexts(raw, 'en'), { 'm.name': 'Idea' });
  assert.equal(storedEnglishTexts(raw, 'sv'), null);
  assert.deepEqual(storedEnglishTexts(null, 'en'), {}, 'ännu inte översatt ⇒ svenska texter med engelskt gränssnitt');
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
