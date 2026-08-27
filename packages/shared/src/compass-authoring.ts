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
