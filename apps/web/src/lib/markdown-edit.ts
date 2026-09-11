/**
 * Ren, enhetstestad textmanipulation för anslagstavlans redigerare
 * (CLAUDE.md § 37.6): verktygsradens formateringar arbetar på ett
 * `{ value, start, end }`-snapshot av textrutan och returnerar nytt värde +
 * ny markering. Ingen DOM här — komponenten applicerar resultatet.
 */

export interface TextSel {
  value: string;
  start: number;
  end: number;
}

export type InlineWrap = 'bold' | 'italic' | 'strike' | 'code';
export type LinePrefix = 'h2' | 'h3' | 'ul' | 'ol' | 'check' | 'quote';

const WRAP: Record<InlineWrap, string> = { bold: '**', italic: '*', strike: '~~', code: '`' };
const PLACEHOLDER: Record<InlineWrap, string> = { bold: 'fet text', italic: 'kursiv text', strike: 'struken', code: 'kod' };

/** Omsluter markeringen (eller växlar bort omslutningen om den redan finns). */
export function wrapSelection(sel: TextSel, kind: InlineWrap): TextSel {
  const m = WRAP[kind];
  const { value } = sel;
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  const before = value.slice(0, start);
  const inner = value.slice(start, end);
  const after = value.slice(end);

  // Redan omslutet (markeringen ligger innanför markörerna) → ta bort.
  if (before.endsWith(m) && after.startsWith(m) && (inner || kind !== 'bold')) {
    const nv = before.slice(0, -m.length) + inner + after.slice(m.length);
    return { value: nv, start: start - m.length, end: end - m.length };
  }
  // Markeringen inkluderar markörerna → ta bort.
  if (inner.length >= 2 * m.length && inner.startsWith(m) && inner.endsWith(m)) {
    const core = inner.slice(m.length, -m.length);
    return { value: before + core + after, start, end: start + core.length };
  }
  const text = inner || PLACEHOLDER[kind];
  const nv = before + m + text + m + after;
  return { value: nv, start: start + m.length, end: start + m.length + text.length };
}

function lineBounds(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nl = value.indexOf('\n', end);
  return { from, to: nl === -1 ? value.length : nl };
}

const PREFIX_RE: Record<LinePrefix, RegExp> = {
  h2: /^##\s+/,
  h3: /^###\s+/,
  ul: /^[-*]\s+(?!\[[ xX]\]\s)/,
  ol: /^\d{1,3}[.)]\s+/,
  check: /^[-*]\s+\[[ xX]\]\s+/,
  quote: /^>\s?/
};
const ANY_PREFIX = /^(#{1,3}\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d{1,3}[.)]\s+|>\s?)/;

function prefixFor(kind: LinePrefix, index: number): string {
  switch (kind) {
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'ul':
      return '- ';
    case 'ol':
      return `${index + 1}. `;
    case 'check':
      return '- [ ] ';
    case 'quote':
      return '> ';
  }
}

/**
 * Sätter/tar bort ett radprefix på alla rader i markeringen. Om ALLA rader
 * redan har prefixet tas det bort (toggle); annars ersätts ev. annat prefix.
 */
export function toggleLinePrefix(sel: TextSel, kind: LinePrefix): TextSel {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  const { from, to } = lineBounds(sel.value, start, end);
  const block = sel.value.slice(from, to);
  const lines = block.split('\n');
  const allHave = lines.every((l) => PREFIX_RE[kind].test(l));
  const next = lines.map((l, i) => {
    const bare = l.replace(ANY_PREFIX, '');
    return allHave ? bare : prefixFor(kind, i) + bare;
  });
  const replaced = next.join('\n');
  const value = sel.value.slice(0, from) + replaced + sel.value.slice(to);
  const delta = replaced.length - block.length;
  if (lines.length === 1) {
    const shift = next[0].length - lines[0].length;
    return { value, start: Math.max(from, start + shift), end: Math.max(from, end + shift) };
  }
  return { value, start: from, end: to + delta };
}

/** Infogar text vid markören (ersätter markeringen) och ställer markören efter. */
export function insertAtCursor(sel: TextSel, text: string): TextSel {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  const value = sel.value.slice(0, start) + text + sel.value.slice(end);
  return { value, start: start + text.length, end: start + text.length };
}

/**
 * Länk: markerad text blir länktext och markören hamnar i url-delen; utan
 * markering infogas en mall med "länktext" markerad.
 */
export function insertLink(sel: TextSel, url = 'https://'): TextSel {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  const inner = sel.value.slice(start, end);
  if (inner) {
    const text = `[${inner}](${url})`;
    const value = sel.value.slice(0, start) + text + sel.value.slice(end);
    const urlStart = start + inner.length + 3;
    return { value, start: urlStart, end: urlStart + url.length };
  }
  const text = `[länktext](${url})`;
  const value = sel.value.slice(0, start) + text + sel.value.slice(end);
  return { value, start: start + 1, end: start + 1 + 'länktext'.length };
}

/**
 * Enter i en lista: fortsätter listan på nästa rad (nästa nummer för
 * numrerade, tom checkruta för checklistor). Enter på en TOM listrad
 * avslutar listan (prefixet tas bort). Returnerar null när raden inte är
 * en listrad (låt webbläsaren sköta Enter).
 */
export function continueList(sel: TextSel): TextSel | null {
  if (sel.start !== sel.end) return null;
  const pos = sel.start;
  const { from } = lineBounds(sel.value, pos, pos);
  const line = sel.value.slice(from, pos);
  const m = line.match(/^(\s*)([-*]\s+\[[ xX]\]\s+|[-*]\s+|(\d{1,3})[.)]\s+)(.*)$/);
  if (!m) return null;
  const indent = m[1];
  const marker = m[2];
  const rest = m[4];
  if (!rest.trim()) {
    // Tom listrad → avsluta listan.
    const value = sel.value.slice(0, from) + sel.value.slice(pos);
    return { value, start: from, end: from };
  }
  let next: string;
  if (m[3]) next = `${Number(m[3]) + 1}. `;
  else if (/\[[ xX]\]/.test(marker)) next = '- [ ] ';
  else next = marker.replace(/\s+$/, ' ');
  const ins = `\n${indent}${next}`;
  const value = sel.value.slice(0, pos) + ins + sel.value.slice(pos);
  return { value, start: pos + ins.length, end: pos + ins.length };
}
