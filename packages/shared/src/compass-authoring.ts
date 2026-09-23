/**
 * Startupkompassen — ren, delad modell för att FÖRFATTA moduler och frågor
 * (CLAUDE.md § 23, § 31).
 *
 * Ligger i `@platform/shared` så att UI-formulären, server-actionerna och det
 * delade skrivlagret (som röststyrda agenten går igenom) normaliserar
 * flow-typer, frågetyper, nycklar och svarsalternativ på EXAKT samma sätt.
 * Ingen divergerande kopia — och logiken går att enhetstesta.
 *
 * Ingen PII: detta är modul-/frågekonfiguration, inte besökardata.
 */

/** Modulens flödestyp. Speglar `compass_modules.flow_type` (select). */
export const COMPASS_FLOW_TYPES = ['chat', 'wizard', 'quiz'] as const;
export type CompassFlowType = (typeof COMPASS_FLOW_TYPES)[number];

/** Frågans inmatningstyp. Speglar `compass_questions.input_type` (select). */
export const COMPASS_INPUT_TYPES = [
  'short_text',
  'long_text',
  'choice',
  'multi_choice',
  'scale',
  'email',
  'phone'
] as const;
export type CompassInputType = (typeof COMPASS_INPUT_TYPES)[number];

/** Frågetyper som bär svarsalternativ. */
export const COMPASS_CHOICE_INPUT_TYPES: readonly CompassInputType[] = ['choice', 'multi_choice'];

export const MAX_COMPASS_CHOICES = 20;
export const MAX_COMPASS_CHOICE_LABEL = 200;
export const MAX_COMPASS_QUESTION_PROMPT = 2000;
export const MAX_COMPASS_MODULE_NAME = 200;

export function isCompassFlowType(v: unknown): v is CompassFlowType {
  return typeof v === 'string' && (COMPASS_FLOW_TYPES as readonly string[]).includes(v);
}

export function isCompassInputType(v: unknown): v is CompassInputType {
  return typeof v === 'string' && (COMPASS_INPUT_TYPES as readonly string[]).includes(v);
}

export function compassInputTypeHasChoices(v: CompassInputType): boolean {
  return COMPASS_CHOICE_INPUT_TYPES.includes(v);
}

/**
 * Slug/nyckel-normalisering. Samma regler som modul-admin använder: gemener,
 * diakriter bort, allt annat än a–z/0–9 blir bindestreck. Max 60 tecken.
 */
export function slugifyCompassKey(raw: string, maxLen = 60): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/** Resultatprofil-/hinknyckel (understreck i stället för bindestreck). */
export function normalizeCompassBucketKey(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export interface CompassChoice {
  value: string;
  label: string;
  /** Poäng i intervall-läge (summeras och jämförs mot profilernas min/max). */
  score?: number;
  /** Poäng per resultatprofil i topp-hink-läge, t.ex. `{ green: 2 }`. */
  buckets?: Record<string, number>;
}

/**
 * Normaliserar en lista svarsalternativ oavsett var den kommer ifrån (visuell
 * editor, importerad JSON eller en AI-agents verktygsanrop). Ogiltiga poster
 * tas bort tyst; 0-poäng utelämnas så lagringen hålls minimal.
 */
export function normalizeCompassChoices(raw: unknown): CompassChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: CompassChoice[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= MAX_COMPASS_CHOICES) break;
    let label = '';
    let valueSource = '';

    if (typeof item === 'string') {
      label = item.trim();
      valueSource = label;
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      label = String(rec.label ?? rec.value ?? '').trim();
      valueSource = String(rec.value ?? rec.label ?? '');
    } else {
      continue;
    }

    label = label.slice(0, MAX_COMPASS_CHOICE_LABEL);
    const value = slugifyCompassKey(valueSource);
    if (!value || !label || seen.has(value)) continue;
    seen.add(value);

    const choice: CompassChoice = { value, label };

    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const score = Number(rec.score);
      if (rec.score !== undefined && rec.score !== '' && Number.isFinite(score) && score !== 0) {
        choice.score = score;
      }
      if (rec.buckets && typeof rec.buckets === 'object' && !Array.isArray(rec.buckets)) {
        const buckets: Record<string, number> = {};
        for (const [k, v] of Object.entries(rec.buckets as Record<string, unknown>)) {
          const key = normalizeCompassBucketKey(k);
          const n = Number(v);
          if (key && Number.isFinite(n) && n !== 0) buckets[key] = n;
        }
        if (Object.keys(buckets).length > 0) choice.buckets = buckets;
      }
    }

    out.push(choice);
  }

  return out;
}

/* ────────────────────────────────────────────────────────────────────
   Frågeordning (sort_order)
   ──────────────────────────────────────────────────────────────────── */

/** Steg mellan två frågor som läggs efter varandra. */
export const COMPASS_QUESTION_SORT_STEP = 10;

export interface CompassQuestionInsertPlan {
  /** `sort_order` för den nya frågan. */
  sortOrder: number;
  /**
   * Satt när gapet mellan grannarna tagit slut: NYA `sort_order` för de
   * befintliga frågorna (samma ordning som `existingSorted`), som måste
   * skrivas INNAN den nya frågan skapas. Utelämnad = inga andra rader rörs.
   */
  renumber?: number[];
}

/**
 * Planerar var en ny fråga hamnar, deterministiskt och oberoende av i vilken
 * ordning anropen råkar bearbetas.
 *
 * - `position` = frågans ABSOLUTA plats i modulen (1 = första frågan). Är
 *   platsen bortom sista frågan läggs den sist; annars skjuts den in mellan
 *   grannarna (heltalsmittpunkt). Tar gapet slut numreras modulen om
 *   (10, 20, 30 …) — `renumber` säger vad de befintliga ska få.
 * - Ingen position: frågan läggs sist (`högsta + steg`).
 *
 * `existingSorted` = befintliga frågors sort_order i visningsordning
 * (stigande). Ogiltiga värden (NaN, negativa) behandlas som 0. På en tom modul
 * blir första frågan 10, andra 20 osv.
 */
export function planCompassQuestionInsert(
  existingSorted: readonly (number | null | undefined)[],
  position?: number | null
): CompassQuestionInsertPlan {
  const existing = existingSorted.map((v) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  });
  const highest = existing.length > 0 ? Math.max(...existing) : 0;
  const positionRaw = Number(position);
  const hasPosition =
    position !== undefined && position !== null && Number.isFinite(positionRaw) && positionRaw >= 1;
  const index = hasPosition ? Math.floor(positionRaw) - 1 : existing.length;

  if (index >= existing.length) {
    return { sortOrder: highest + COMPASS_QUESTION_SORT_STEP };
  }

  const prev = index === 0 ? 0 : existing[index - 1]!;
  const next = existing[index]!;
  if (next - prev >= 2) {
    return { sortOrder: Math.floor((prev + next) / 2) };
  }

  // Inget gap kvar — numrera om med jämna steg och lägg den nya på sin plats.
  const renumber: number[] = [];
  let sortOrder = 0;
  let cursor = 0;
  for (let i = 0; i <= existing.length; i++) {
    cursor += COMPASS_QUESTION_SORT_STEP;
    if (i === index) {
      sortOrder = cursor;
      cursor += COMPASS_QUESTION_SORT_STEP;
    }
    if (i < existing.length) renumber.push(cursor);
  }
  return { sortOrder, renumber };
}

/** Minsta gemensamma form för att sortera frågor på läsvägen. */
export interface CompassQuestionOrderable {
  id: string;
  sort_order?: number | null;
  created?: string | null;
}

/**
 * Sorterar frågor deterministiskt: `sort_order` stigande, sedan `created`
 * (äldst först), sedan `id`. PocketBase avgör lika `sort_order` godtyckligt
 * (slumpade id:n), vilket är hur "6, 1, 9" uppstod — två frågor som fick
 * samma sort_order visades i olika ordning varje gång. Görs i JS (inte via
 * PB:s `sort`-sträng) så att en instans utan `created`-fältet (migration
 * 1700000126) inte får 400 och en tom lista. Stabil och muterar inte input.
 */
export function sortCompassQuestions<T extends CompassQuestionOrderable>(questions: readonly T[]): T[] {
  const num = (v: number | null | undefined): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return [...questions].sort((a, b) => {
    const so = num(a.sort_order) - num(b.sort_order);
    if (so !== 0) return so;
    const ca = String(a.created ?? '');
    const cb = String(b.created ?? '');
    if (ca !== cb) {
      // Saknad tidsstämpel sist — en post utan `created` är alltid "okänd".
      if (!ca) return 1;
      if (!cb) return -1;
      return ca < cb ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
