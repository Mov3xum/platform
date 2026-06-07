/**
 * Ren, IO-fri text-extraktion ur OOXML-fragment (DOCX `word/document.xml`,
 * PPTX `ppt/slides/slideN.xml`). ZIP-uppackningen sker i den server-only:a
 * anroparen (lib/ai/attachments.ts); den här modulen tar XML-strängen och
 * plockar ut läsbar text i dokumentordning.
 *
 * Medvetet fri från `server-only`/Node-api:er så att parsningen kan
 * ENHETSTESTAS (ooxml-text.test.ts) — samma mönster som fuzzy/redaction/rank.
 */

/** Avkodar XML-entiteter till vanliga tecken. */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export interface OoxmlTextOptions {
  /** Textnod-tagg utan namespace-kolon, t.ex. `t` (matchar `w:t`/`a:t`). */
  textTag: string;
  /** Stäng-tagg som markerar styckesgräns, t.ex. `w:p` (DOCX) / `a:p` (PPTX). */
  paraTag: string;
}

/**
 * Plockar ut text ur ett OOXML-fragment i dokumentordning: varje textnod
 * (`<w:t>…</w:t>` / `<a:t>…</a:t>`) läses, och varje styckesslut blir en
 * radbrytning. Hanterar `<w:tab/>` → tab och `<w:br/>`/`<a:br/>` → radbryt.
 * Normaliserar bort överflödiga tomrader till sist.
 */
export function ooxmlToText(xml: string, opts: OoxmlTextOptions): string {
  if (!xml) return '';

  // Matcha — i dokumentordning — en textnod, ett styckesslut, en radbrytning
  // (`<w:br/>`/`<a:br/>`) eller en tab (`<w:tab/>`). `textTag`/`paraTag` är
  // lokala namn så vi tillåter ett valfritt namespace-prefix (w:/a:) före dem.
  const localText = opts.textTag.replace(/^[a-z]+:/i, '');
  const localPara = opts.paraTag.replace(/^[a-z]+:/i, '');
  const re = new RegExp(
    `<(?:[a-z]+:)?${localText}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z]+:)?${localText}>` +
      `|</(?:[a-z]+:)?${localPara}>` +
      `|<(?:[a-z]+:)?br\\b[^>]*/?>` +
      `|<(?:[a-z]+:)?tab\\b[^>]*/?>`,
    'gi'
  );

  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (/tab\b/i.test(m[0])) out += '\t';
    else out += '\n'; // styckesslut eller radbrytning
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extraherar text ur DOCX `word/document.xml`. */
export function docxXmlToText(documentXml: string): string {
  return ooxmlToText(documentXml, { textTag: 'w:t', paraTag: 'w:p' });
}

/** Extraherar text ur en PPTX-slide (`ppt/slides/slideN.xml`). */
export function pptxSlideXmlToText(slideXml: string): string {
  return ooxmlToText(slideXml, { textTag: 'a:t', paraTag: 'a:p' });
}
