import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueList, insertAtCursor, insertLink, toggleLinePrefix, wrapSelection } from './markdown-edit';

test('wrapSelection omsluter, växlar bort och ger platshållare utan markering', () => {
  assert.deepEqual(wrapSelection({ value: 'hej du', start: 0, end: 3 }, 'bold'), { value: '**hej** du', start: 2, end: 5 });
  // Toggle: markeringen ligger innanför markörerna.
  assert.deepEqual(wrapSelection({ value: '**hej** du', start: 2, end: 5 }, 'bold'), { value: 'hej du', start: 0, end: 3 });
  // Toggle: markeringen inkluderar markörerna.
  assert.deepEqual(wrapSelection({ value: '*a* b', start: 0, end: 3 }, 'italic'), { value: 'a b', start: 0, end: 1 });
  const ph = wrapSelection({ value: '', start: 0, end: 0 }, 'code');
  assert.equal(ph.value, '`kod`');
  assert.equal(ph.value.slice(ph.start, ph.end), 'kod');
});

test('toggleLinePrefix sätter, ersätter och tar bort prefix på alla rader', () => {
  const v = 'a\nb\nc';
  const ul = toggleLinePrefix({ value: v, start: 0, end: v.length }, 'ul');
  assert.equal(ul.value, '- a\n- b\n- c');
  const ol = toggleLinePrefix({ value: ul.value, start: 0, end: ul.value.length }, 'ol');
  assert.equal(ol.value, '1. a\n2. b\n3. c');
  const off = toggleLinePrefix({ value: ol.value, start: 0, end: ol.value.length }, 'ol');
  assert.equal(off.value, 'a\nb\nc');
  // En rad, markören mitt i raden — flyttas med prefixet.
  const one = toggleLinePrefix({ value: 'rubrik', start: 3, end: 3 }, 'h2');
  assert.deepEqual(one, { value: '## rubrik', start: 6, end: 6 });
  assert.equal(toggleLinePrefix({ value: '- x', start: 0, end: 0 }, 'check').value, '- [ ] x');
  assert.equal(toggleLinePrefix({ value: 'x', start: 0, end: 0 }, 'quote').value, '> x');
});

test('insertAtCursor och insertLink', () => {
  assert.deepEqual(insertAtCursor({ value: 'ab', start: 1, end: 1 }, '🎉'), { value: 'a🎉b', start: 3, end: 3 });
  const l = insertLink({ value: 'se Movexum nu', start: 3, end: 10 });
  assert.equal(l.value, 'se [Movexum](https://) nu');
  assert.equal(l.value.slice(l.start, l.end), 'https://');
  const e = insertLink({ value: '', start: 0, end: 0 });
  assert.equal(e.value.slice(e.start, e.end), 'länktext');
});

test('continueList fortsätter punkt-, nummer- och checklistor och avslutar på tom rad', () => {
  const a = continueList({ value: '- ett', start: 5, end: 5 });
  assert.deepEqual(a, { value: '- ett\n- ', start: 8, end: 8 });
  const n = continueList({ value: '1. ett\n2. två', start: 13, end: 13 });
  assert.equal(n?.value, '1. ett\n2. två\n3. ');
  const c = continueList({ value: '- [x] klart', start: 11, end: 11 });
  assert.equal(c?.value, '- [x] klart\n- [ ] ');
  const end = continueList({ value: '- ett\n- ', start: 8, end: 8 });
  assert.deepEqual(end, { value: '- ett\n', start: 6, end: 6 });
  assert.equal(continueList({ value: 'vanlig text', start: 11, end: 11 }), null);
});
