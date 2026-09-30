import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOGIN_ACCENT,
  DEFAULT_LOGIN_BRANDING,
  DEFAULT_LOGIN_HEADLINE,
  DEFAULT_LOGIN_LAYOUT,
  LOGIN_ACCENTS,
  LOGIN_ACCENT_LABELS,
  LOGIN_BRANDING_FIELDS,
  LOGIN_CAPTION_MAX,
  LOGIN_HEADLINE_MAX,
  LOGIN_LAYOUTS,
  LOGIN_LAYOUT_META,
  LOGIN_TAGLINE_MAX,
  cleanLoginCaption,
  cleanLoginText,
  loginAccentVar,
  loginLayoutFeaturesMedia,
  missingLoginBrandingFields,
  normalizeLoginAccent,
  normalizeLoginBranding,
  normalizeLoginLayout,
  validateLoginBrandingInput
} from './login-branding.ts';

test('varje mall har metadata; varje accent har etikett', () => {
  for (const layout of LOGIN_LAYOUTS) {
    const meta = LOGIN_LAYOUT_META[layout];
    assert.ok(meta.label && meta.description && meta.mediaHint, `saknar meta för ${layout}`);
  }
  for (const accent of LOGIN_ACCENTS) {
    assert.ok(LOGIN_ACCENT_LABELS[accent], `saknar etikett för ${accent}`);
  }
});

test('normalizeLoginLayout: giltiga passerar, okänt/tomt ⇒ centered (bakåtkompatibelt)', () => {
  for (const layout of LOGIN_LAYOUTS) assert.equal(normalizeLoginLayout(layout), layout);
  assert.equal(normalizeLoginLayout(' Split-Left '), 'split_left');
  assert.equal(normalizeLoginLayout(''), DEFAULT_LOGIN_LAYOUT);
  assert.equal(normalizeLoginLayout(undefined), 'centered');
  assert.equal(normalizeLoginLayout('bogus'), 'centered');
  assert.equal(normalizeLoginLayout(42), 'centered');
});

test('mallar som bygger på media', () => {
  assert.equal(loginLayoutFeaturesMedia('centered'), false);
  assert.equal(loginLayoutFeaturesMedia('panel'), false);
  assert.equal(loginLayoutFeaturesMedia('split_left'), true);
  assert.equal(loginLayoutFeaturesMedia('cover'), true);
});

test('accent: bara brand-tokens, aldrig hex; CSS-variabeln pekar på --movexum-*', () => {
  assert.equal(normalizeLoginAccent('lila'), 'lila');
  assert.equal(normalizeLoginAccent('#ff0000'), DEFAULT_LOGIN_ACCENT);
  assert.equal(normalizeLoginAccent(null), 'morkbla');
  assert.equal(loginAccentVar('gron'), 'var(--movexum-gron)');
  assert.equal(loginAccentVar('nope'), 'var(--movexum-morkbla)');
});

test('cleanLoginText: trimmar, plattar radbrytningar och cappar', () => {
  assert.equal(cleanLoginText('  Hej \n världen  ', 50), 'Hej världen');
  assert.equal(cleanLoginText('x'.repeat(200), 10), 'x'.repeat(10));
  assert.equal(cleanLoginText(7, 10), '');
});

test('cleanLoginCaption: behåller radbrytningar, tar bort tomma rader, cappar rader och längd', () => {
  assert.equal(cleanLoginCaption('  Välkommen till \r\n\n  Movexum!  '), 'Välkommen till\nMovexum!');
  assert.equal(cleanLoginCaption('a\nb\nc\nd'), 'a\nb\nc', 'max tre rader');
  assert.equal(cleanLoginCaption('x'.repeat(LOGIN_CAPTION_MAX + 50)).length, LOGIN_CAPTION_MAX);
  assert.equal(cleanLoginCaption('   '), '');
  assert.equal(cleanLoginCaption(undefined), '');
});

test('normalizeLoginBranding: tom post ⇒ standard; fyllda fält tolkas', () => {
  assert.deepEqual(normalizeLoginBranding(null), DEFAULT_LOGIN_BRANDING);
  assert.deepEqual(normalizeLoginBranding({}), DEFAULT_LOGIN_BRANDING);
  const b = normalizeLoginBranding({
    login_layout: 'cover',
    login_accent: 'morklila',
    login_headline: '  Hej!  ',
    login_tagline: '',
    login_caption: 'Hej\nvärlden',
    login_image: 'omslag_ab12cd34ef.webp',
    login_video: ['film_0123456789.mp4']
  });
  assert.equal(b.layout, 'cover');
  assert.equal(b.accent, 'morklila');
  assert.equal(b.headline, 'Hej!');
  assert.equal(b.tagline, DEFAULT_LOGIN_BRANDING.tagline, 'tom underrubrik ⇒ standardtext');
  assert.equal(b.caption, 'Hej\nvärlden');
  assert.equal(normalizeLoginBranding({ login_headline: 'Hej' }).caption, '', 'saknad bildtext ⇒ tom (faller tillbaka på rubriken)');
  assert.equal(b.imageFilename, 'omslag_ab12cd34ef.webp');
  assert.equal(b.videoFilename, 'film_0123456789.mp4');
});

test('missingLoginBrandingFields: PB-schema utan migrationen upptäcks', () => {
  assert.deepEqual(missingLoginBrandingFields({ id: 'x', name: 'Movexum' }), [...LOGIN_BRANDING_FIELDS]);
  const full: Record<string, unknown> = { id: 'x' };
  for (const f of LOGIN_BRANDING_FIELDS) full[f] = '';
  assert.deepEqual(missingLoginBrandingFields(full), []);
  delete full.login_video;
  assert.deepEqual(missingLoginBrandingFields(full), ['login_video']);
});

test('validateLoginBrandingInput: okänd mall/accent avvisas med giltiga namn; tomt ⇒ standard', () => {
  const bad = validateLoginBrandingInput({ layout: 'hero', accent: 'lila' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /split_left/);
  const badAccent = validateLoginBrandingInput({ layout: 'panel', accent: '#123456' });
  assert.equal(badAccent.ok, false);
  const ok = validateLoginBrandingInput({
    layout: '',
    accent: '',
    headline: ' Välkommen ',
    tagline: 'Logga in.',
    caption: ' Bild \n text '
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.login_layout, DEFAULT_LOGIN_LAYOUT);
    assert.equal(ok.value.login_accent, DEFAULT_LOGIN_ACCENT);
    assert.equal(ok.value.login_headline, 'Välkommen');
    assert.equal(ok.value.login_tagline, 'Logga in.');
    assert.equal(ok.value.login_caption, 'Bild\ntext');
  }
  const tooLongCaption = validateLoginBrandingInput({ caption: 'x'.repeat(LOGIN_CAPTION_MAX + 1) });
  assert.equal(tooLongCaption.ok, false);
  const tooLong = validateLoginBrandingInput({ headline: 'x'.repeat(LOGIN_HEADLINE_MAX + 1) });
  assert.equal(tooLong.ok, false);
  const tooLongTag = validateLoginBrandingInput({ tagline: 'x'.repeat(LOGIN_TAGLINE_MAX + 1) });
  assert.equal(tooLongTag.ok, false);
  assert.equal(DEFAULT_LOGIN_HEADLINE.length <= LOGIN_HEADLINE_MAX, true);
});
