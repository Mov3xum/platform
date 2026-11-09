import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeVisitorReply,
  stripInternalMarkers,
  stripStructuredTrailer,
  VISITOR_REPLY_RULES
} from './reply-sanitize';

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

test('tar bort interna räknare och markörer på egen rad', () => {
  const reply =
    '[Utbyte 1 av 5]\n\nEn spade på sju meter – det låter som något specifikt! Vem har behov av den?';
  assert.equal(
    stripInternalMarkers(reply),
    'En spade på sju meter – det låter som något specifikt! Vem har behov av den?'
  );
  assert.equal(stripInternalMarkers('(Svar 2/5)\nHej igen!'), 'Hej igen!');
  assert.equal(stripInternalMarkers('Tur 3 av 5:\nHej igen!'), 'Hej igen!');
  assert.equal(stripInternalMarkers('Hej!\n\n[Intern notering: kontaktuppgifter saknas]\n\nVad heter du?'), 'Hej!\n\nVad heter du?');
  assert.equal(stripInternalMarkers('Hej!\n[Meddelande 4 av 5]'), 'Hej!');
});

test('rör inte vanliga rader som råkar innehålla samma ord', () => {
  const t = 'Svar på din fråga: ja, det går.\nSteg 1 är att prata med kunder.\n(Jag förstår att det är svårt.)';
  assert.equal(stripInternalMarkers(t), t);
  assert.equal(stripInternalMarkers('Har du 3 personer i teamet?'), 'Har du 3 personer i teamet?');
});

test('sanitizeVisitorReply kombinerar båda lagren', () => {
  assert.equal(
    sanitizeVisitorReply('[Utbyte 5 av 5]\nTack för samtalet!\n\n<lead>{"a":1}</lead>'),
    'Tack för samtalet!'
  );
});

test('reglerna förbjuder interna räknare i klartext', () => {
  assert.match(VISITOR_REPLY_RULES, /Utbyte 1 av 5/);
  assert.match(VISITOR_REPLY_RULES, /interna räknare/);
});
