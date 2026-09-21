import type { EmojiEntry, EmojiGroup } from './emoji/data';

/**
 * Ren, enhetstestad logik för emoji-väljaren på anslagstavlan (CLAUDE.md
 * § 37.6): sökning (engelska Unicode-namn + svenska sökord), hudton och
 * "senast använda". Ingen IO utöver den valfria localStorage-bekvämligheten
 * (aldrig en datakälla — tom lista om lagringen saknas).
 */

export const EMOJI_RECENT_KEY = 'movexum-emoji-recent';
export const EMOJI_RECENT_MAX = 24;

/** Fitzpatrick-modifierare: 0 = ingen, 1–5 = ljus → mörk. */
export const SKIN_TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'] as const;
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

const VS16 = '️';

/** Lägger hudton på en emoji som stödjer det (annars oförändrad). */
export function applySkinTone(char: string, tone: SkinTone, bases: ReadonlySet<string>): string {
  if (tone === 0) return char;
  const base = char.replace(VS16, '');
  if (!bases.has(base)) return char;
  // Modifieraren ersätter VS16 och sätts direkt efter bastecknet.
  return base + SKIN_TONES[tone];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Söker över alla grupper. Prefixträff på ett ord rankas före substring-träff;
 * resultatet är stabilt (gruppordning) inom samma rang. Tom fråga → tom lista
 * (väljaren visar då kategorierna).
 */
export function searchEmoji(
  query: string,
  groups: readonly EmojiGroup[],
  limit = 60
): EmojiEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { entry: EmojiEntry; score: number }[] = [];
  for (const g of groups) {
    for (const entry of g.emoji) {
      const hay = normalize(`${entry[1]} ${entry[2] ?? ''}`);
      const words = hay.split(/[\s-]+/);
      // Första svenska sökordet är "huvudordet" (hjärta → ❤️ före 💔).
      const primary = entry[2] ? normalize(entry[2]).split(/\s+/)[0] : normalize(entry[1]).split(/\s+/)[0];
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (primary === t) score += 4;
        else if (words.some((w) => w === t)) score += 3;
        else if (words.some((w) => w.startsWith(t))) score += 2;
        else if (hay.includes(t)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok) scored.push({ entry, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

/** Senast använda — nyast först, dedupad, cappad. Ren (tar in listan). */
export function pushRecent(recent: readonly string[], char: string): string[] {
  const next = [char, ...recent.filter((c) => c !== char)];
  return next.slice(0, EMOJI_RECENT_MAX);
}

export function loadRecentEmoji(): string[] {
  try {
    const raw = window.localStorage.getItem(EMOJI_RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, EMOJI_RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecentEmoji(list: readonly string[]): void {
  try {
    window.localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(list.slice(0, EMOJI_RECENT_MAX)));
  } catch {
    /* bekvämlighet — aldrig en datakälla */
  }
}
