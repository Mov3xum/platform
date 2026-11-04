/**
 * Startupkompassen — STARTSIDA i en publik modul (CLAUDE.md § 23.11).
 *
 * En modul kan visa en första sida INUTI flödet, innan den första frågan
 * (eller chatten) visas: en beskrivning av vad modulen är till för och vad
 * Movexum vill ha ut av svaren, så att idébäraren läser igenom och förstår
 * syftet innan hen börjar svara. Texten skrivs av personalen i modul-admin
 * (steg 2) som ren text med stycken; den här rena modulen tolkar texten
 * till block (stycken, punktlistor, mellanrubriker) som den publika sidan
 * renderar som React-element — aldrig som HTML.
 *
 * Ren, server-/React-fri logik (ingen IO) — enhetstestad.
 */

export const COMPASS_START_PAGE_TITLE_MAX = 200;
export const COMPASS_START_PAGE_BODY_MAX = 6000;
/** Rubrik på startsidan när personalen inte skrivit någon egen. */
export const DEFAULT_COMPASS_START_PAGE_TITLE = 'Innan du börjar';

export type CompassStartPageBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

/** Har modulen en startsida att visa? (Bara texten avgör — en rubrik utan text visas inte.) */
export function hasCompassStartPage(
  m: { start_page_body?: string | null } | null | undefined
): boolean {
  return Boolean(m && typeof m.start_page_body === 'string' && m.start_page_body.trim());
}

/** Rubriken som visas: personalens egen, annars standardtexten. */
export function compassStartPageTitle(
  m: { start_page_title?: string | null } | null | undefined
): string {
  const own = m && typeof m.start_page_title === 'string' ? m.start_page_title.trim() : '';
  return own || DEFAULT_COMPASS_START_PAGE_TITLE;
}

const LIST_PREFIX = /^(?:[-*•]|\d+[.)])\s+/;
const HEADING_PREFIX = /^#{1,3}\s+/;

/**
 * Tolkar startsidans text till block. Stycken skiljs av tomrad; rader som
 * börjar med `-`, `*`, `•` eller `1.`/`1)` blir punkter i en lista; rader
 * som börjar med `#` blir mellanrubriker. Radbrytningar inom ett stycke
 * slås ihop till mellanslag. Tom/ogiltig text ⇒ tom lista.
 */
export function parseCompassStartPageBlocks(body: string | null | undefined): CompassStartPageBlock[] {
  if (typeof body !== 'string') return [];
  const text = body.replace(/\r\n?/g, '\n').slice(0, COMPASS_START_PAGE_BODY_MAX);
  const blocks: CompassStartPageBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: 'list', items: list });
      list = [];
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (HEADING_PREFIX.test(line)) {
      flushParagraph();
      flushList();
      const heading = line.replace(HEADING_PREFIX, '').trim();
      if (heading) blocks.push({ kind: 'heading', text: heading });
      continue;
    }
    if (LIST_PREFIX.test(line)) {
      flushParagraph();
      const item = line.replace(LIST_PREFIX, '').trim();
      if (item) list.push(item);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
