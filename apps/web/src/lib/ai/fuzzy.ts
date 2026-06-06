/**
 * Ren, IO-fri fuzzy-matchning för chattens `search_records`-verktyg.
 *
 * Medvetet fri från `server-only`, PocketBase och `@/`-importer så att logiken
 * kan ENHETSTESTAS (körs av `yarn test` via apps/web/src/lib/ai/*.test.ts).
 * PocketBases `~`-operator är ett exakt substring-LIKE som missar felstavningar
 * och ordföljd — den här modulen rankar kandidater på token-överlapp +
 * normaliserad Levenshtein så att "workshop 1 internationalisring" hittar en
 * workshop som heter "Internationalisering".
 */

/** Fyllnadsord (svenska + vanliga etiketter) som inte bär söksignal. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'workshop',
  'modul',
  'moment',
  'steg',
  'del',
  'nr',
  'nummer',
  'bolag',
  'bolaget',
  'foretag',
  'företag',
  'företaget',
  'om',
  'och',
  'eller',
  'samt',
  'med',
  'för',
  'till',
  'från',
  'den',
  'det',
  'dem',
  'den',
  'en',
  'ett',
  'som',
  'är',
  'av',
  'på',
  'i',
  'the',
  'a',
  'of',
  'for'
]);

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFC').trim();
}

/** Splittar på icke-alfanumeriska tecken (behåller å/ä/ö via \p{L}). */
export function tokenize(input: string): string[] {
  return normalize(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * De betydelsebärande tokens i en fråga: släpper fyllnadsord, ordningstal
 * (rena siffror som "1") och alltför korta tokens. Faller tillbaka på samtliga
 * tokens om filtret skulle tömma listan (t.ex. frågan "workshop 1").
 */
export function significantTokens(input: string): string[] {
  const all = tokenize(input);
  const sig = all.filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)
  );
  return sig.length > 0 ? sig : all;
}

/** Klassisk Levenshtein-distans (DP, O(a·b)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Likhet 0..1 mellan två tokens (1 = identiska). Substring ger hög bonus. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = Math.max(a.length, b.length);
  if (m === 0) return 1;
  let s = 1 - levenshtein(a, b) / m;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    s = Math.max(s, 0.9);
  }
  return s < 0 ? 0 : s;
}

/**
 * Poängsätter hur väl frågans tokens matchar en text (token-medel av bästa
 * per-token-likhet), med en stark bonus om hela frågan finns som substring.
 */
function scoreTokensAgainstText(qTokens: string[], text: string): number {
  const tTokens = tokenize(text);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;
  let sum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of tTokens) {
      const s = similarity(q, t);
      if (s > best) best = s;
      if (best === 1) break;
    }
    sum += best;
  }
  let score = sum / qTokens.length;
  const joined = qTokens.join(' ');
  if (joined && normalize(text).includes(joined)) score = Math.max(score, 0.95);
  return score;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Rankar kandidater mot en fritext-fråga. `getTexts` returnerar de textfält
 * (redan PII-maskade) som en kandidat ska matchas mot; kandidatens poäng är
 * den bästa enskilda fält-poängen. Returnerar topp-`limit` över `threshold`,
 * fallande.
 */
export function rankCandidates<T>(
  query: string,
  candidates: T[],
  getTexts: (c: T) => string[],
  opts: { limit?: number; threshold?: number } = {}
): Scored<T>[] {
  const limit = opts.limit ?? 8;
  const threshold = opts.threshold ?? 0.45;
  const qTokens = significantTokens(query);
  const scored: Scored<T>[] = [];
  for (const c of candidates) {
    let best = 0;
    for (const txt of getTexts(c)) {
      if (!txt) continue;
      const s = scoreTokensAgainstText(qTokens, txt);
      if (s > best) best = s;
      if (best >= 0.95) break;
    }
    if (best >= threshold) scored.push({ item: c, score: Math.round(best * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
