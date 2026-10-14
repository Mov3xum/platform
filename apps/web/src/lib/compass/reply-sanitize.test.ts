import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripStructuredTrailer, VISITOR_REPLY_RULES } from './reply-sanitize';

test('tar bort <lead>-block med JSON efter texten', () => {
  const reply =
    'Tack för samtalet! Du är välkommen att kontakta Movexum.\n\n<lead>\n{\n  "samtycke": false,\n  "kontakt": { "namn": "" }\n}\n</lead>';
  assert.equal(stripStructuredTrailer(reply), 'Tack för samtalet! Du är välkommen att kontakta Movexum.');
});

test('tar bort oavslutad tagg + kodblock + naket JSON', () => {
  assert.equal(stripStructuredTrailer('Hej!\n\n<lead>\n{ "a": 1'), 'Hej!');
  assert.equal(stripStructuredTrailer('Hej!\n\n```json\n{"a":1}\n```\n'), 'Hej!');
  assert.equal(stripStructuredTrailer('Hej!\n{ "a": 1, "b": [1,2] }'), 'Hej!');
});

test('rör inte vanlig text och klammer i löptext', () => {
  const t = 'Vi ses {snart}! Har du 3 personer i teamet?';
  assert.equal(stripStructuredTrailer(t), t);
  assert.equal(stripStructuredTrailer('Rad 1\n\n\n\nRad 2'), 'Rad 1\n\nRad 2');
});

test('ett svar som bara är JSON blir tomt', () => {
  assert.equal(stripStructuredTrailer('{"a":1}'), '');
});

test('reglerna förbjuder JSON/taggar i klartext', () => {
  assert.match(VISITOR_REPLY_RULES, /ALDRIG JSON/);
  assert.match(VISITOR_REPLY_RULES, /<lead>/);
});
