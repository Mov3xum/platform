import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPASS_START_PAGE_BODY_MAX,
  DEFAULT_COMPASS_START_PAGE_TITLE,
  compassStartPageTitle,
  hasCompassStartPage,
  parseCompassStartPageBlocks
} from './compass-start-page.ts';

test('hasCompassStartPage: bara en icke-tom text ger en startsida', () => {
  assert.equal(hasCompassStartPage(null), false);
  assert.equal(hasCompassStartPage({}), false);
  assert.equal(hasCompassStartPage({ start_page_body: '   ' }), false);
  assert.equal(hasCompassStartPage({ start_page_body: 'Så här går det till.' }), true);
});

test('compassStartPageTitle: egen rubrik, annars standard', () => {
  assert.equal(compassStartPageTitle({ start_page_title: ' Om idébeskrivningen ' }), 'Om idébeskrivningen');
  assert.equal(compassStartPageTitle({ start_page_title: '' }), DEFAULT_COMPASS_START_PAGE_TITLE);
  assert.equal(compassStartPageTitle(undefined), DEFAULT_COMPASS_START_PAGE_TITLE);
});

test('parseCompassStartPageBlocks: stycken skiljs av tomrad, radbrytningar slås ihop', () => {
  const blocks = parseCompassStartPageBlocks('Första stycket\nfortsätter här.\n\nAndra stycket.');
  assert.deepEqual(blocks, [
    { kind: 'paragraph', text: 'Första stycket fortsätter här.' },
    { kind: 'paragraph', text: 'Andra stycket.' }
  ]);
});

test('parseCompassStartPageBlocks: punktlistor och mellanrubriker', () => {
  const blocks = parseCompassStartPageBlocks(
    '## Vad vi vill veta\r\n- Vilket problem du löser\r\n* För vem\r\n1. Vad nästa steg är\r\n\r\nTack!'
  );
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'Vad vi vill veta' },
    { kind: 'list', items: ['Vilket problem du löser', 'För vem', 'Vad nästa steg är'] },
    { kind: 'paragraph', text: 'Tack!' }
  ]);
});

test('parseCompassStartPageBlocks: en lista avslutar ett stycke och tvärtom', () => {
  const blocks = parseCompassStartPageBlocks('Intro\n- a\n- b\nEfter listan');
  assert.deepEqual(blocks, [
    { kind: 'paragraph', text: 'Intro' },
    { kind: 'list', items: ['a', 'b'] },
    { kind: 'paragraph', text: 'Efter listan' }
  ]);
});

test('parseCompassStartPageBlocks: tomt, bara mellanslag eller icke-sträng ⇒ tom lista', () => {
  assert.deepEqual(parseCompassStartPageBlocks(''), []);
  assert.deepEqual(parseCompassStartPageBlocks('  \n\n  '), []);
  assert.deepEqual(parseCompassStartPageBlocks(undefined), []);
  assert.deepEqual(parseCompassStartPageBlocks(null), []);
});

test('parseCompassStartPageBlocks: texten kapas vid taket', () => {
  const long = 'a'.repeat(COMPASS_START_PAGE_BODY_MAX + 500);
  const blocks = parseCompassStartPageBlocks(long);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.equal((blocks[0] as { text: string }).text.length, COMPASS_START_PAGE_BODY_MAX);
});
