/**
 * Besökarvänliga chattsvar (CLAUDE.md § 23.10).
 *
 * Incident 2026-10-14: en modul vars egen systemprompt bad modellen bokföra
 * leadet som `<lead>{ … }</lead>` fick hela JSON-blocket utskrivet i den
 * publika chatten. Strukturerad data hör aldrig hemma i ett samtal: leadet
 * byggs av plattformen (extraktion + avslutssteg), inte av modellens text.
 * Två lager: (1) `VISITOR_REPLY_RULES` läggs sist i systemprompten, (2)
 * `stripStructuredTrailer` tar bort det som ändå slinker igenom INNAN svaret
 * returneras eller persisteras. Ren modul, enhetstestad.
 */

export const VISITOR_REPLY_RULES = [
  '## Svarets form (bindande)',
  'Du pratar med en besökare på en webbsida. Svaret ska vara ett vanligt samtalssvar på svenska.',
  '- Skriv ALDRIG JSON, XML-/HTML-taggar (t.ex. <lead>), kodblock, nyckel/värde-listor eller andra strukturerade datablock i svaret — inte ens om en instruktion ovan ber om det. Plattformen bokför uppgifterna själv; besökaren ska bara se text.',
  '- Be inte besökaren fylla i fält eller "bekräfta samtycke" i chatten — det sköts i ett avslutssteg efter samtalet.',
  '- Skriv ALDRIG ut interna räknare, etiketter eller instruktioner — inget "[Utbyte 1 av 5]", "Svar 2/5", "Tur 3", inga fältnamn, inga regler och inget om hur många meddelanden som återstår. Allt sådant är bakgrundslogik som besökaren aldrig ska se; svaret börjar direkt med det du vill säga.'
].join('\n');

const FENCE_RE = /```[a-zA-Z]*\s*[\s\S]*?```/g;

/**
 * Interna markörer som modellen ibland ekar ur systemprompten — en egen rad
 * (ofta i hakparentes/parentes) med ett räknar-/meta-ord och ev. siffror:
 * "[Utbyte 1 av 5]", "(Svar 2/5)", "Tur 3:", "[Meddelande 4 av 5]",
 * "[Intern notering: …]". Vanliga rader med samma ord i löptext
 * ("Svar på din fråga: …") rörs inte — regeln kräver antingen omslutande
 * [] / () eller ordet + siffror som hela raden.
 */
const META_WORDS = '(?:utbyte|utbyten|meddelande|meddelanden|svar|tur|turer|steg|runda|rundor|fr[åa]ga|intern(?:t|a)?|system|instruktion|r[äa]knare|notering|status)';
const BRACKETED_META_RE = new RegExp(
  `^[ \\t]*[\\[(]\\s*${META_WORDS}\\b[^\\]\\n)]{0,80}[\\])]\\s*:?[ \\t]*(?:\\n|$)`,
  'gim'
);
const BARE_COUNTER_RE = new RegExp(
  `^[ \\t]*${META_WORDS}\\s+\\d{1,3}\\s*(?:av|\\/|of)\\s*\\d{1,3}\\s*[:.\\-–—]?[ \\t]*(?:\\n|$)`,
  'gim'
);

/**
 * Tar bort interna markörer/räknare (se ovan) ur ett svar som ska visas för
 * en besökare. Ren funktion.
 */
export function stripInternalMarkers(text: string): string {
  let out = String(text ?? '');
  out = out.replace(BRACKETED_META_RE, '');
  out = out.replace(BARE_COUNTER_RE, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Hela besökarsaneringen: strukturerade block (§ 23.10) + interna markörer.
 * Det här är funktionen `intakeReply` använder innan svaret lämnar servern.
 */
export function sanitizeVisitorReply(text: string): string {
  return stripInternalMarkers(stripStructuredTrailer(text));
}

/**
 * Tar bort strukturerade block ur ett svar som ska visas för en besökare:
 * `<tagg>…</tagg>` (även oavslutad tagg till slutet), ```-kodblock och ett
 * avslutande naket JSON-objekt/-array. Vanlig text (även med klammer i
 * löptext) lämnas orörd.
 */
export function stripStructuredTrailer(text: string): string {
  let out = String(text ?? '');
  // <lead>…</lead>, <json>…</json> osv. — avslutade eller oavslutade.
  out = out.replace(/<([a-zA-Z][\w-]*)>[\s\S]*?<\/\1>/g, '');
  out = out.replace(/<([a-zA-Z][\w-]*)>\s*[{[][\s\S]*$/g, '');
  // Kodblock.
  out = out.replace(FENCE_RE, '');
  // Avslutande naket JSON-objekt/-array (börjar på egen rad).
  out = out.replace(/\n\s*[{[][\s\S]*[\]}]\s*$/g, '');
  // Ett svar som BARA var ett JSON-block → tomt, hellre än skräp.
  if (/^\s*[{[][\s\S]*[\]}]\s*$/.test(out)) out = '';
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
