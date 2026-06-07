import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeXmlEntities,
  docxXmlToText,
  pptxSlideXmlToText,
  ooxmlToText
} from './ooxml-text';

test('decodeXmlEntities: vanliga entiteter + numeriska', () => {
  assert.equal(decodeXmlEntities('a &amp; b &lt;c&gt; &#65; &#x42;'), 'a & b <c> A B');
});

test('docxXmlToText: stycken blir radbrytningar, text i ordning', () => {
  const xml =
    '<w:document><w:body>' +
    '<w:p><w:r><w:t>Hej</w:t></w:r><w:r><w:t xml:space="preserve"> världen</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Rad två</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  assert.equal(docxXmlToText(xml), 'Hej världen\nRad två');
});

test('docxXmlToText: hanterar tab och br inuti stycke', () => {
  const xml = '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>';
  assert.equal(docxXmlToText(xml), 'A\tB\nC');
});

test('pptxSlideXmlToText: a:t-noder och a:p-stycken', () => {
  const xml =
    '<p:sld><p:cSld><p:spTree>' +
    '<a:p><a:r><a:t>Rubrik</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>Punkt 1</a:t></a:r></a:p>' +
    '</p:spTree></p:cSld></p:sld>';
  assert.equal(pptxSlideXmlToText(xml), 'Rubrik\nPunkt 1');
});

test('ooxmlToText: tom input → tom sträng, kollapsar tomrader', () => {
  assert.equal(ooxmlToText('', { textTag: 'w:t', paraTag: 'w:p' }), '');
  const xml = '<w:p><w:t>A</w:t></w:p><w:p></w:p><w:p></w:p><w:p><w:t>B</w:t></w:p>';
  assert.equal(docxXmlToText(xml), 'A\n\nB');
});
