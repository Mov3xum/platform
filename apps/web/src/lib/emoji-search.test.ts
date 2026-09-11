import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySkinTone, pushRecent, searchEmoji, EMOJI_RECENT_MAX } from './emoji-search';
import { EMOJI_GROUPS, SKIN_TONE_BASES } from './emoji/data';

test('emoji-katalogen är komplett och utan dubbletter', () => {
  const all = EMOJI_GROUPS.flatMap((g) => g.emoji.map((e) => e[0]));
  assert.ok(all.length > 1000, 'fullt emoji-paket');
  assert.equal(new Set(all).size, all.length, 'inga dubbletter');
  assert.ok(EMOJI_GROUPS.some((g) => g.id === 'flags'));
  for (const g of EMOJI_GROUPS) for (const e of g.emoji) assert.ok(e[1].length > 0, `namn saknas för ${e[0]}`);
});

test('searchEmoji träffar på svenska sökord och engelska namn, rankar exakta ord först', () => {
  const sv = searchEmoji('hjärta', EMOJI_GROUPS);
  assert.ok(sv.length > 0);
  assert.equal(sv[0][0], '❤️');
  const en = searchEmoji('rocket', EMOJI_GROUPS);
  assert.equal(en[0][0], '🚀');
  // Diakritik-okänslig och flera termer (alla måste träffa).
  assert.equal(searchEmoji('tummen upp', EMOJI_GROUPS)[0][0], '👍');
  assert.deepEqual(searchEmoji('   ', EMOJI_GROUPS), []);
  assert.deepEqual(searchEmoji('xyzzy-finns-inte', EMOJI_GROUPS), []);
});

test('applySkinTone lägger modifierare bara på bas-emoji som stödjer det', () => {
  assert.equal(applySkinTone('👍', 3, SKIN_TONE_BASES), '👍🏽');
  // VS16 tas bort innan modifieraren (annars renderas två tecken).
  assert.equal(applySkinTone('✌️', 1, SKIN_TONE_BASES), '✌🏻');
  assert.equal(applySkinTone('🚀', 3, SKIN_TONE_BASES), '🚀');
  assert.equal(applySkinTone('👍', 0, SKIN_TONE_BASES), '👍');
});

test('pushRecent dedupar, sätter nyast först och cappar', () => {
  assert.deepEqual(pushRecent(['🎉', '🚀'], '🚀'), ['🚀', '🎉']);
  const many = Array.from({ length: 40 }, (_, i) => String(i));
  assert.equal(pushRecent(many, 'x').length, EMOJI_RECENT_MAX);
});
