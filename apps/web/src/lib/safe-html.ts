/**
 * Delad, säker HTML-rendering för användar-/AI-genererat innehåll.
 *
 * ALLT innehåll som kommer från användare, AI-svar, bilagor eller externa
 * källor MÅSTE renderas via dessa helpers innan det når
 * `dangerouslySetInnerHTML` — annars uppstår stored/reflected XSS.
 *
 * - `escapeHtml`     → ren textutmatning (ingen markup tillåts).
 * - `inlineMarkdown` → escapar först, tillåter därefter endast **fet** text.
 *   Oparade `**` strippas så att råa asterisker aldrig når UI:t.
 * - `markdownToHtml` → liten markdown-delmängd (rubriker, listor, fet,
 *   stycken). Allt textinnehåll escapas; endast hårdkodade klasser/taggar
 *   genereras av oss.
 * - `chatMarkdownToHtml` → samma delmängd med chatt-anpassade klasser
 *   (används av chattbubblorna så att modellens markdown renderas snyggt
 *   i stället för att visas som råa `**`/`-`-tecken).
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inlineMarkdown(s: string): string {
  return (
    escapeHtml(s)
      .replace(
        /\*\*(.*?)\*\*/g,
        '<strong class="font-semibold text-foreground">$1</strong>'
      )
      // Oparade ** (modellen glömde stänga) ska aldrig synas som råtecken.
      .replace(/\*\*/g, '')
  );
}

interface MarkdownClasses {
  h1: string;
  h2: string;
  h3: string;
  ul: string;
  ol: string;
  li: string;
  dot: string;
  num: string;
  p: string;
}

const DEFAULT_CLASSES: MarkdownClasses = {
  h1: 'font-heading font-semibold text-[20px] mt-6 mb-3 tracking-tight',
  h2: 'font-heading font-semibold text-[17px] mt-6 mb-2 tracking-tight',
  h3: 'font-heading font-semibold text-[15px] mt-5 mb-2',
  ul: 'space-y-1.5 mt-2 mb-3',
  ol: 'space-y-1.5 mt-2 mb-3',
  li: 'flex gap-3 text-foreground-muted',
  dot: 'w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0',
  num: 'shrink-0 tabular-nums text-foreground-subtle',
  p: 'leading-relaxed mb-3 text-foreground-muted'
};

// Chatt-bubblor: fullt förgrundsfärgad text, tightare vertikal rytm och
// ingen marginal efter sista stycket (bubblan sätter sin egen padding).
const CHAT_CLASSES: MarkdownClasses = {
  h1: 'font-heading font-semibold text-[16px] mt-4 mb-1.5 text-foreground',
  h2: 'font-heading font-semibold text-[15.5px] mt-4 mb-1.5 text-foreground',
  h3: 'font-heading font-semibold text-[15px] mt-3 mb-1 text-foreground',
  ul: 'space-y-1 my-2 last:mb-0',
  ol: 'space-y-1 my-2 last:mb-0',
  li: 'flex gap-2.5 text-foreground',
  dot: 'w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0',
  num: 'shrink-0 tabular-nums text-foreground-subtle',
  p: 'leading-relaxed mb-2.5 last:mb-0 text-foreground'
};

const ORDERED_ITEM = /^(\d{1,3})[.)]\s+(.*)$/;

function renderMarkdown(md: string, c: MarkdownClasses): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (list) {
      out.push(list === 'ul' ? '</ul>' : '</ol>');
      list = null;
    }
  };

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      closeList();
      out.push('');
      continue;
    }
    const ordered = l.match(ORDERED_ITEM);
    if (l.startsWith('### ')) {
      closeList();
      out.push(`<h3 class="${c.h3}">${inlineMarkdown(l.slice(4))}</h3>`);
    } else if (l.startsWith('## ')) {
      closeList();
      out.push(`<h2 class="${c.h2}">${inlineMarkdown(l.slice(3))}</h2>`);
    } else if (l.startsWith('# ')) {
      closeList();
      out.push(`<h1 class="${c.h1}">${inlineMarkdown(l.slice(2))}</h1>`);
    } else if (l.startsWith('- ') || l.startsWith('* ')) {
      if (list !== 'ul') {
        closeList();
        out.push(`<ul class="${c.ul}">`);
        list = 'ul';
      }
      out.push(
        `<li class="${c.li}"><span class="${c.dot}"></span><span>${inlineMarkdown(l.slice(2))}</span></li>`
      );
    } else if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push(`<ol class="${c.ol}">`);
        list = 'ol';
      }
      out.push(
        `<li class="${c.li}"><span class="${c.num}">${ordered[1]}.</span><span>${inlineMarkdown(ordered[2])}</span></li>`
      );
    } else {
      closeList();
      out.push(`<p class="${c.p}">${inlineMarkdown(l)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

/**
 * Mini markdown → HTML. Stödjer headers, paragrafer, punkt-/numrerade listor
 * och fet text. Tillräckligt för Mistral-output och korta beskrivningsfält.
 * All inmatning escapas — inga råa taggar från källan släpps igenom.
 */
export function markdownToHtml(md: string): string {
  return renderMarkdown(md, DEFAULT_CLASSES);
}

/** Chatt-variant av `markdownToHtml` — samma säkerhet, chatt-anpassad stil. */
export function chatMarkdownToHtml(md: string): string {
  return renderMarkdown(md, CHAT_CLASSES);
}
