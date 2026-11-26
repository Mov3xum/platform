/**
 * Ren tolkning av Mistrals svarsinnehåll (CLAUDE.md § 9.2). Ingen IO —
 * enhetstestad i `mistral-content.test.ts`.
 *
 * VARFÖR: resonerande modeller (Mistral Large 4 alltid; Small 4 med
 * `reasoning_effort: "high"`) svarar inte med en sträng. `message.content` är
 * en LISTA av delar:
 *   - `{ type: "thinking", thinking: [{ type: "text", text }] }` — resonemanget
 *   - `{ type: "text", text }`                                    — svaret
 * och i en ström byter `delta.content` form under svaret: listor med
 * thinking-delar först, en lista med både sista thinking-delen och första
 * textdelen i övergången, därefter rena strängar. Klienten läste bara
 * strängar: ett svar utan ström blev en lista där text förväntades, och en
 * ström tappade tyst början av svaret (källa: docs.mistral.ai → Reasoning,
 * läst 2026-11-26).
 *
 * Resonemanget visas, lagras och loggas aldrig — bara svarstexten går vidare.
 */

interface ContentChunk {
  type?: unknown;
  text?: unknown;
}

function chunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (!chunk || typeof chunk !== 'object') return '';
  const c = chunk as ContentChunk;
  // Bara textdelar är svar. thinking, tool_reference, image_url m.fl. hoppas över.
  if (c.type === 'text' && typeof c.text === 'string') return c.text;
  return '';
}

/**
 * Svarstexten ur `message.content` eller ett ström-delta: en sträng som den
 * är, en lista som sina textdelar i ordning, allt annat som tom sträng.
 */
export function extractAnswerText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(chunkText).join('');
  return '';
}

/** True om innehållet bär en resonemangsdel (för diagnostik — aldrig texten). */
export function hasThinkingChunk(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (c) => !!c && typeof c === 'object' && (c as ContentChunk).type === 'thinking'
  );
}

/**
 * Tolkar API:ets felsvar: säger det att MODELLEN är okänd (avvecklad, stängd
 * eller felstavad)? Då är nästa id i kedjan värt att prova. Stängda modeller
 * svarar 404 enligt Mistrals livscykelpolicy; äldre svar är 400
 * "Invalid model".
 */
export function isUnknownModelError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const text = (body || '').toLowerCase();
  if (!text.includes('model')) return status === 404 && text.trim() === '';
  return /invalid model|model[^"]{0,60}(not found|does not exist|not exist|unknown|no longer|retired|deprecated|not available)|unknown model|no such model/.test(
    text
  );
}

/**
 * Säger felsvaret att `reasoning_effort` (värdet eller parametern) avvisades?
 * Då görs anropet om utan parametern — modellen använder sin egen standard.
 */
export function isReasoningEffortError(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /reasoning[_ ]?effort|reasoning/i.test(body || '');
}
