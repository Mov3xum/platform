/**
 * Delad, säker HTML-rendering för användar-/AI-genererat innehåll.
 *
 * ALLT innehåll som kommer från användare, AI-svar, bilagor eller externa
 * källor MÅSTE renderas via dessa helpers innan det når
 * `dangerouslySetInnerHTML` — annars uppstår stored/reflected XSS.
 *
 * - `escapeHtml`     → ren textutmatning (ingen markup tillåts).
 * - `inlineMarkdown` → escapar först, tillåter därefter endast **fet** text.
 * - `markdownToHtml` → liten markdown-delmängd (rubriker, listor, fet,
 *   stycken). Allt textinnehåll escapas; endast hårdkodade klasser/taggar
 *   genereras av oss.
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
  return escapeHtml(s).replace(
    /\*\*(.*?)\*\*/g,
    '<strong class="font-semibold text-foreground">$1</strong>'
  );
}

/**
 * Mini markdown → HTML. Stödjer headers, paragrafer, listor och fet text.
 * Tillräckligt för Mistral-output och korta beskrivningsfält. All inmatning
 * escapas — inga råa taggar från källan släpps igenom.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push('');
      continue;
    }
    if (l.startsWith('### ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h3 class="font-heading font-semibold text-[15px] mt-5 mb-2">${escapeHtml(l.slice(4))}</h3>`);
    } else if (l.startsWith('## ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h2 class="font-heading font-semibold text-[17px] mt-6 mb-2 tracking-tight">${escapeHtml(l.slice(3))}</h2>`);
    } else if (l.startsWith('# ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h1 class="font-heading font-semibold text-[20px] mt-6 mb-3 tracking-tight">${escapeHtml(l.slice(2))}</h1>`);
    } else if (l.startsWith('- ') || l.startsWith('* ')) {
      if (!inList) {
        out.push('<ul class="space-y-1.5 mt-2 mb-3">');
        inList = true;
      }
      out.push(
        `<li class="flex gap-3 text-foreground-muted"><span class="w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0"></span><span>${inlineMarkdown(l.slice(2))}</span></li>`
      );
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<p class="leading-relaxed mb-3 text-foreground-muted">${inlineMarkdown(l)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
