/**
 * Delad, säker HTML-rendering för användar-/AI-genererat innehåll.
 *
 * ALLT innehåll som kommer från användare, AI-svar, bilagor eller externa
 * källor MÅSTE renderas via dessa helpers innan det når
 * `dangerouslySetInnerHTML` — annars uppstår stored/reflected XSS.
 *
 * - `escapeHtml`     → ren textutmatning (ingen markup tillåts).
 * - `inlineMarkdown` → escapar först, tillåter därefter en liten inline-
 *   delmängd: **fet**, *kursiv*, ~~struken~~, `kod`, [länk](url) och
 *   automatiskt länkade https-adresser. Oparade `**` strippas så att råa
 *   asterisker aldrig når UI:t. Länkar släpps bara igenom som interna
 *   sökvägar (/…) eller http(s)-URL:er — aldrig `javascript:`/`data:`.
 * - `markdownToHtml` → liten markdown-delmängd (rubriker, listor, checkrutor,
 *   citat, avdelare, stycken + inline ovan). Allt textinnehåll escapas; endast
 *   hårdkodade klasser/taggar genereras av oss.
 * - `chatMarkdownToHtml` → samma delmängd med chatt-anpassade klasser
 *   (används av chattbubblorna OCH anslagstavlan så att markdown renderas
 *   snyggt i stället för att visas som råa `**`/`-`-tecken).
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface InlineClasses {
  strong: string;
  em: string;
  del: string;
  code: string;
  a: string;
}

const DEFAULT_INLINE: InlineClasses = {
  strong: 'font-semibold text-foreground',
  em: 'italic',
  del: 'line-through opacity-70',
  code: 'rounded bg-canvas-muted px-1 py-0.5 text-[0.92em] text-foreground',
  a: 'text-link underline decoration-link/40 underline-offset-2 hover:decoration-link'
};

/**
 * Är (den redan HTML-escapade) adressen säker som href? Interna sökvägar
 * (/… men inte //…) eller http(s)://. Inga blanksteg, inga vinkelparenteser.
 */
export function isSafeHref(escaped: string): boolean {
  if (!escaped || /\s|<|>/.test(escaped)) return false;
  if (escaped.startsWith('/')) return !escaped.startsWith('//');
  return /^https?:\/\/[^\s]+$/i.test(escaped);
}

// Platshållartecken för redan renderade fragment (kod/länkar) så de inte
// bearbetas igen av fet-/kursiv-reglerna. Kontrolltecknet strippas ur
// inmatningen först, så det kan aldrig komma från källan.
const TOKEN = String.fromCharCode(1);
const TOKEN_RE = new RegExp(`${TOKEN}(\\d+)${TOKEN}`, 'g');
const TOKEN_STRIP = new RegExp(TOKEN, 'g');

function anchor(href: string, text: string, cls: string): string {
  const external = !href.startsWith('/');
  return `<a href="${href}" class="${cls}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
}

function emphasis(s: string, c: InlineClasses): string {
  return (
    s
      .replace(/\*\*(.+?)\*\*/g, `<strong class="${c.strong}">$1</strong>`)
      // Oparade ** (modellen glömde stänga) ska aldrig synas som råtecken.
      .replace(/\*\*/g, '')
      .replace(/~~(.+?)~~/g, `<del class="${c.del}">$1</del>`)
      // *kursiv* — inte inuti ord (2*3*4) och inte med blanksteg innanför.
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)/g, `$1<em class="${c.em}">$2</em>`)
      .replace(/(^|[^\w])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, `$1<em class="${c.em}">$2</em>`)
  );
}

function renderInline(raw: string, c: InlineClasses): string {
  const slots: string[] = [];
  const stash = (html: string) => {
    slots.push(html);
    return `${TOKEN}${slots.length - 1}${TOKEN}`;
  };

  let s = escapeHtml(raw).replace(TOKEN_STRIP, '');

  // 1. Kodspann — innehållet lämnas orört (ingen fet/kursiv inuti).
  s = s.replace(/`([^`\n]+)`/g, (_, code: string) => stash(`<code class="${c.code}">${code}</code>`));

  // 2. Markdown-länkar [text](url). Texten får inline-formatering, url:en
  //    måste vara säker — annars visas bara texten.
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => {
    const inner = emphasis(text, c);
    return isSafeHref(href) ? stash(anchor(href, inner, c.a)) : inner;
  });

  s = emphasis(s, c);

  // 3. Automatisk länkning av bara https-adresser (aldrig inuti redan
  //    stashade länkar — de är tokens nu). Avslutande skiljetecken lämnas utanför.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+?)([.,;:!?)]*)(?=\s|$)/g, (_, pre: string, url: string, tail: string) =>
    isSafeHref(url) ? `${pre}${stash(anchor(url, url, c.a))}${tail}` : `${pre}${url}${tail}`
  );

  return s.replace(TOKEN_RE, (_, i: string) => slots[Number(i)] ?? '');
}

export function inlineMarkdown(s: string): string {
  return renderInline(s, DEFAULT_INLINE);
}

interface MarkdownClasses extends InlineClasses {
  h1: string;
  h2: string;
  h3: string;
  ul: string;
  ol: string;
  li: string;
  dot: string;
  num: string;
  check: string;
  p: string;
  blockquote: string;
  hr: string;
}

const DEFAULT_CLASSES: MarkdownClasses = {
  ...DEFAULT_INLINE,
  h1: 'font-heading font-semibold text-[20px] mt-6 mb-3 tracking-tight',
  h2: 'font-heading font-semibold text-[17px] mt-6 mb-2 tracking-tight',
  h3: 'font-heading font-semibold text-[15px] mt-5 mb-2',
  ul: 'space-y-1.5 mt-2 mb-3',
  ol: 'space-y-1.5 mt-2 mb-3',
  li: 'flex gap-3 text-foreground-muted',
  dot: 'w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0',
  num: 'shrink-0 tabular-nums text-foreground-subtle',
  check: 'shrink-0 text-[15px] leading-[1.35]',
  p: 'leading-relaxed mb-3 text-foreground-muted',
  blockquote: 'border-l-2 border-brand/50 pl-3 my-3 text-foreground-muted italic',
  hr: 'my-4 border-0 border-t border-default'
};

// Chatt-bubblor: fullt förgrundsfärgad text, tightare vertikal rytm och
// ingen marginal efter sista stycket (bubblan sätter sin egen padding).
const CHAT_CLASSES: MarkdownClasses = {
  ...DEFAULT_INLINE,
  h1: 'font-heading font-semibold text-[16px] mt-4 mb-1.5 text-foreground',
  h2: 'font-heading font-semibold text-[15.5px] mt-4 mb-1.5 text-foreground',
  h3: 'font-heading font-semibold text-[15px] mt-3 mb-1 text-foreground',
  ul: 'space-y-1 my-2 last:mb-0',
  ol: 'space-y-1 my-2 last:mb-0',
  li: 'flex gap-2.5 text-foreground',
  dot: 'w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0',
  num: 'shrink-0 tabular-nums text-foreground-subtle',
  check: 'shrink-0 text-[15px] leading-[1.35]',
  p: 'leading-relaxed mb-2.5 last:mb-0 text-foreground',
  blockquote: 'border-l-2 border-brand/50 pl-3 my-2.5 text-foreground-muted',
  hr: 'my-3 border-0 border-t border-default'
};

const ORDERED_ITEM = /^(\d{1,3})[.)]\s+(.*)$/;
const CHECK_ITEM = /^[-*]\s+\[( |x|X)\]\s+(.*)$/;

function renderMarkdown(md: string, c: MarkdownClasses): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let quote: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(list === 'ul' ? '</ul>' : '</ol>');
      list = null;
    }
  };
  const closeQuote = () => {
    if (quote.length) {
      out.push(`<blockquote class="${c.blockquote}">${quote.map((q) => renderInline(q, c)).join('<br>')}</blockquote>`);
      quote = [];
    }
  };

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      closeList();
      closeQuote();
      out.push('');
      continue;
    }
    if (l.startsWith('>')) {
      closeList();
      quote.push(l.replace(/^>\s?/, ''));
      continue;
    }
    closeQuote();
    const ordered = l.match(ORDERED_ITEM);
    const check = l.match(CHECK_ITEM);
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) {
      closeList();
      out.push(`<hr class="${c.hr}">`);
    } else if (l.startsWith('### ')) {
      closeList();
      out.push(`<h3 class="${c.h3}">${renderInline(l.slice(4), c)}</h3>`);
    } else if (l.startsWith('## ')) {
      closeList();
      out.push(`<h2 class="${c.h2}">${renderInline(l.slice(3), c)}</h2>`);
    } else if (l.startsWith('# ')) {
      closeList();
      out.push(`<h1 class="${c.h1}">${renderInline(l.slice(2), c)}</h1>`);
    } else if (check) {
      if (list !== 'ul') {
        closeList();
        out.push(`<ul class="${c.ul}">`);
        list = 'ul';
      }
      const done = check[1].toLowerCase() === 'x';
      out.push(
        `<li class="${c.li}"><span class="${c.check}" aria-hidden="true">${done ? '☑' : '☐'}</span><span${done ? ' class="line-through opacity-60"' : ''}>${renderInline(check[2], c)}</span></li>`
      );
    } else if (l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• ')) {
      if (list !== 'ul') {
        closeList();
        out.push(`<ul class="${c.ul}">`);
        list = 'ul';
      }
      out.push(`<li class="${c.li}"><span class="${c.dot}"></span><span>${renderInline(l.slice(2), c)}</span></li>`);
    } else if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push(`<ol class="${c.ol}">`);
        list = 'ol';
      }
      out.push(`<li class="${c.li}"><span class="${c.num}">${ordered[1]}.</span><span>${renderInline(ordered[2], c)}</span></li>`);
    } else {
      closeList();
      out.push(`<p class="${c.p}">${renderInline(l, c)}</p>`);
    }
  }
  closeList();
  closeQuote();
  return out.join('\n');
}

/**
 * Mini markdown → HTML. Stödjer headers, paragrafer, punkt-/numrerade listor,
 * checkrutor, citat, avdelare och inline-formatering (fet/kursiv/struken/kod/
 * länk). Tillräckligt för Mistral-output, anslagstavlan och korta
 * beskrivningsfält. All inmatning escapas — inga råa taggar från källan
 * släpps igenom; länkar bara som säkra href.
 */
export function markdownToHtml(md: string): string {
  return renderMarkdown(md, DEFAULT_CLASSES);
}

/** Chatt-variant av `markdownToHtml` — samma säkerhet, chatt-anpassad stil. */
export function chatMarkdownToHtml(md: string): string {
  return renderMarkdown(md, CHAT_CLASSES);
}
