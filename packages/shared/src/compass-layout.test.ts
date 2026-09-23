import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPASS_LAYOUTS,
  COMPASS_LAYOUT_META,
  DEFAULT_COMPASS_LAYOUT,
  compassLayoutShowsMedia,
  isCompassLayout,
  normalizeCompassLayout
} from './compass-layout.ts';

test('varje mall har metadata och en etikett', () => {
  for (const layout of COMPASS_LAYOUTS) {
    const meta = COMPASS_LAYOUT_META[layout];
    assert.ok(meta, `saknar meta för ${layout}`);
    assert.ok(meta.label.length > 0);
    assert.ok(meta.description.length > 0);
    assert.ok(meta.mediaHint.length > 0);
    assert.ok(meta.bestFor.length > 0);
  }
});

test('normalizeCompassLayout: giltiga värden passerar oförändrade', () => {
  for (const layout of COMPASS_LAYOUTS) {
    assert.equal(normalizeCompassLayout(layout), layout);
  }
});

test('normalizeCompassLayout: tomt/okänt/icke-sträng ⇒ classic (bakåtkompatibelt)', () => {
  assert.equal(normalizeCompassLayout(''), 'classic');
  assert.equal(normalizeCompassLayout('   '), 'classic');
  assert.equal(normalizeCompassLayout('nonsense'), 'classic');
  assert.equal(normalizeCompassLayout(undefined), 'classic');
  assert.equal(normalizeCompassLayout(null), 'classic');
  assert.equal(normalizeCompassLayout(42), 'classic');
  assert.equal(DEFAULT_COMPASS_LAYOUT, 'classic');
});

test('normalizeCompassLayout: trimmar, gemenar och tolkar bindestreck/mellanslag', () => {
  assert.equal(normalizeCompassLayout('  Split-Left '), 'split_left');
  assert.equal(normalizeCompassLayout('SPLIT RIGHT'), 'split_right');
  assert.equal(normalizeCompassLayout('Cover'), 'cover');
});

test('normalizeCompassLayout: svenska alias från chatten', () => {
  assert.equal(normalizeCompassLayout('bild till vänster'), 'split_left');
  assert.equal(normalizeCompassLayout('Bild till höger'), 'split_right');
  assert.equal(normalizeCompassLayout('heltäckande'), 'cover');
  assert.equal(normalizeCompassLayout('helskärm'), 'cover');
  assert.equal(normalizeCompassLayout('färgpanel'), 'panel');
  assert.equal(normalizeCompassLayout('klassisk'), 'classic');
  assert.equal(normalizeCompassLayout('avskalad'), 'minimal');
});

test('isCompassLayout är strikt', () => {
  assert.equal(isCompassLayout('cover'), true);
  assert.equal(isCompassLayout('Cover'), false);
  assert.equal(isCompassLayout(''), false);
  assert.equal(isCompassLayout(undefined), false);
});

test('compassLayoutShowsMedia: bara Minimal döljer media', () => {
  for (const layout of COMPASS_LAYOUTS) {
    assert.equal(compassLayoutShowsMedia(layout), layout !== 'minimal', layout);
  }
});
