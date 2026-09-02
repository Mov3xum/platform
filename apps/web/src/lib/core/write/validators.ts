import 'server-only';
import {
  ALL_PHASES,
  ANNUAL_WHEEL_TAG_IDS,
  COMPASS_FLOW_TYPES,
  COMPASS_INPUT_TYPES,
  isAnnualWheelCategoryKey,
  isCompassFlowType,
  isCompassInputType,
  normalizeCompassChoices,
  sanitizeDay,
  sanitizeMonth,
  slugifyCompassKey,
  type AnnualWheelCategory,
  type AnnualWheelTag,
  type CompassChoice,
  type CompassFlowType,
  type CompassInputType,
  type StartupPhase
} from '@platform/shared';

/**
 * Per-fält validering. Returnerar normaliserat värde eller felmeddelande.
 * Validatorerna är fält-orienterade (inte collection-orienterade) så de
 * kan återanvändas mellan create/update.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const STATUS_VALUES = ['active', 'alumni', 'paused', 'rejected'] as const;
type Status = (typeof STATUS_VALUES)[number];

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return null;
}

export function validateNextStep(value: unknown): ValidationResult<string> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'next_step måste vara text.' };
  const trimmed = s.trim();
  if (trimmed.length > 500) {
    return { ok: false, error: 'next_step får vara max 500 tecken.' };
  }
  return { ok: true, value: trimmed };
}

export function validateIrlLevel(value: unknown): ValidationResult<number | null> {
  if (value === null || value === '' || value === undefined) {
    return { ok: true, value: null };
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return { ok: false, error: 'irl_level måste vara ett heltal 1–9.' };
  }
  return { ok: true, value: n };
}

export function validatePhase(value: unknown): ValidationResult<StartupPhase> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'phase saknas.' };
  if (!ALL_PHASES.includes(s as StartupPhase)) {
    return { ok: false, error: `phase måste vara en av: ${ALL_PHASES.join(', ')}.` };
  }
  return { ok: true, value: s as StartupPhase };
}

export function validateStatus(value: unknown): ValidationResult<Status> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'status saknas.' };
  if (!STATUS_VALUES.includes(s as Status)) {
    return { ok: false, error: `status måste vara en av: ${STATUS_VALUES.join(', ')}.` };
  }
  return { ok: true, value: s as Status };
}

export function validateNonEmptyText(
  value: unknown,
  field: string,
  maxLen = 255
): ValidationResult<string> {
  const s = asString(value);
  if (s === null) return { ok: false, error: `${field} måste vara text.` };
  const trimmed = s.trim();
  if (!trimmed) return { ok: false, error: `${field} får inte vara tomt.` };
  if (trimmed.length > maxLen) {
    return { ok: false, error: `${field} får vara max ${maxLen} tecken.` };
  }
  return { ok: true, value: trimmed };
}

export function validateOptionalText(
  value: unknown,
  field: string,
  maxLen = 2000
): ValidationResult<string> {
  if (value === null || value === undefined) return { ok: true, value: '' };
  const s = asString(value);
  if (s === null) return { ok: false, error: `${field} måste vara text.` };
  const trimmed = s.trim();
  if (trimmed.length > maxLen) {
    return { ok: false, error: `${field} får vara max ${maxLen} tecken.` };
  }
  return { ok: true, value: trimmed };
}

const ACTIVITY_STATUS_VALUES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUS_VALUES)[number];

export function validateActivityStatus(value: unknown): ValidationResult<ActivityStatus> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'status saknas.' };
  if (!ACTIVITY_STATUS_VALUES.includes(s as ActivityStatus)) {
    return {
      ok: false,
      error: `status måste vara en av: ${ACTIVITY_STATUS_VALUES.join(', ')}.`
    };
  }
  return { ok: true, value: s as ActivityStatus };
}

const ACTIVITY_KIND_VALUES_FOR_WRITE = ['manual', 'note', 'meeting'] as const;
export type ActivityKindForWrite = (typeof ACTIVITY_KIND_VALUES_FOR_WRITE)[number];

/** Vilka activity-kinds som får skapas via det delade lagret. Övriga
 *  (`tool_run`, `assignment`, `approval`, `integration_sync` ...) är
 *  reserverade för specifika system-flöden och får inte vara fritt
 *  skrivbara från UI/agent. */
export function validateActivityKindForWrite(
  value: unknown
): ValidationResult<ActivityKindForWrite> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'kind saknas.' };
  if (!ACTIVITY_KIND_VALUES_FOR_WRITE.includes(s as ActivityKindForWrite)) {
    return {
      ok: false,
      error: `kind måste vara en av: ${ACTIVITY_KIND_VALUES_FOR_WRITE.join(', ')}.`
    };
  }
  return { ok: true, value: s as ActivityKindForWrite };
}

// ── Årshjul (§ 30) ───────────────────────────────────────────────────────────

/**
 * Kategorinyckel: bara FORMAT valideras här (slug, ≤ 40 tecken). Kategorierna
 * är dynamiska per tenant (§ 30), så att nyckeln faktiskt FINNS kontrolleras i
 * skrivlagret mot `annual_wheel_categories` (`assertCategoryExists`).
 */
export function validateAnnualWheelCategory(
  value: unknown
): ValidationResult<AnnualWheelCategory> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'category saknas.' };
  if (!isAnnualWheelCategoryKey(s)) {
    return {
      ok: false,
      error:
        'category måste vara en kategorinyckel i gemener (a–z, 0–9, - och _), max 40 tecken.'
    };
  }
  return { ok: true, value: s };
}

/**
 * Taggar (tidigare "spår"). VALFRIA och flera tillåtna — tomt värde ger en tom
 * lista. Ogiltiga värden avvisas explicit (i stället för att tyst filtreras)
 * så att en agent/klient får veta att taxonomin inte matchar.
 */
export function validateAnnualWheelTags(value: unknown): ValidationResult<AnnualWheelTag[]> {
  if (value === null || value === undefined || value === '') return { ok: true, value: [] };
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const out: AnnualWheelTag[] = [];
  for (const entry of raw) {
    const s = asString(entry);
    if (s === null) continue;
    if (!ANNUAL_WHEEL_TAG_IDS.includes(s as AnnualWheelTag)) {
      return { ok: false, error: `tags måste vara några av: ${ANNUAL_WHEEL_TAG_IDS.join(', ')}.` };
    }
    if (!out.includes(s as AnnualWheelTag)) out.push(s as AnnualWheelTag);
  }
  return { ok: true, value: out };
}

/**
 * Ansvarig: ett users-id eller null (ingen ansvarig). Formatgranskning bara —
 * att id:t faktiskt tillhör tenantens personal verifieras mot databasen i
 * skrivlagret (defense-in-depth).
 */
export function validateAnnualWheelResponsible(value: unknown): ValidationResult<string | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const s = asString(value);
  if (s === null) return { ok: false, error: 'responsible måste vara ett användar-id eller tomt.' };
  if (s.length > 50) return { ok: false, error: 'responsible är inte ett giltigt användar-id.' };
  return { ok: true, value: s };
}

/** Månad: 1–12, eller null (helårs-/odaterad post). Tomt värde = null. */
export function validateAnnualWheelMonth(value: unknown): ValidationResult<number | null> {
  if (value === null || value === '' || value === undefined) return { ok: true, value: null };
  const m = sanitizeMonth(value);
  if (m === null) return { ok: false, error: 'month måste vara ett heltal 1–12 (eller tomt).' };
  return { ok: true, value: m };
}

/** Dag: 1–31, eller null (hela månaden). Tomt värde = null. */
export function validateAnnualWheelDay(value: unknown): ValidationResult<number | null> {
  if (value === null || value === '' || value === undefined) return { ok: true, value: null };
  const d = sanitizeDay(value);
  if (d === null) return { ok: false, error: 'day måste vara ett heltal 1–31 (eller tomt).' };
  return { ok: true, value: d };
}

export function validateYear(value: unknown): ValidationResult<number> {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    return { ok: false, error: 'year måste vara ett heltal 2000–2100.' };
  }
  return { ok: true, value: n };
}

// ── Startupkompassen — modul-/frågeförfattande (§ 23, § 31) ─────────────────

/** Flödestyp: chat (AI-samtal), wizard (formulär) eller quiz (poäng+profil). */
export function validateCompassFlowType(value: unknown): ValidationResult<CompassFlowType> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'flow_type saknas.' };
  const normalized = s.trim().toLowerCase();
  if (!isCompassFlowType(normalized)) {
    return {
      ok: false,
      error: `flow_type måste vara en av: ${COMPASS_FLOW_TYPES.join(', ')}.`
    };
  }
  return { ok: true, value: normalized };
}

/** Frågans inmatningstyp (`compass_questions.input_type`). */
export function validateCompassInputType(value: unknown): ValidationResult<CompassInputType> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'input_type saknas.' };
  const normalized = s.trim().toLowerCase();
  if (!isCompassInputType(normalized)) {
    return {
      ok: false,
      error: `input_type måste vara en av: ${COMPASS_INPUT_TYPES.join(', ')}.`
    };
  }
  return { ok: true, value: normalized };
}

/**
 * Slug/nyckel. Härleds ur ett fritt namn om det behövs — en agent (eller en
 * röstinmatning) ska aldrig behöva formulera en teknisk nyckel själv.
 */
export function validateSlugKey(
  value: unknown,
  field: string,
  maxLen = 60
): ValidationResult<string> {
  const s = asString(value);
  if (s === null) return { ok: false, error: `${field} måste vara text.` };
  const slug = slugifyCompassKey(s, maxLen);
  if (!slug) {
    return {
      ok: false,
      error: `${field} måste innehålla minst en bokstav eller siffra.`
    };
  }
  return { ok: true, value: slug };
}

/**
 * Svarsalternativ. Normaliseras med den delade, enhetstestade helpern så att
 * UI-formulären och agentens verktyg ger IDENTISKT lagrat resultat.
 */
export function validateCompassChoices(
  value: unknown,
  inputType: CompassInputType
): ValidationResult<CompassChoice[] | undefined> {
  const needsChoices = inputType === 'choice' || inputType === 'multi_choice';
  if (!needsChoices) return { ok: true, value: undefined };

  const choices = normalizeCompassChoices(value);
  if (choices.length < 2) {
    return {
      ok: false,
      error:
        'En fråga med svarsalternativ behöver minst två giltiga alternativ ' +
        '(skicka dem som en lista med etiketter).'
    };
  }
  return { ok: true, value: choices };
}

/** Bool som tål "true"/"on"/1 från formulär och verktygsanrop. */
export function validateBool(value: unknown, fallback = false): ValidationResult<boolean> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: fallback };
  }
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') return { ok: true, value: value !== 0 };
  const s = String(value).trim().toLowerCase();
  if (['true', 'on', 'yes', 'ja', '1'].includes(s)) return { ok: true, value: true };
  if (['false', 'off', 'no', 'nej', '0'].includes(s)) return { ok: true, value: false };
  return { ok: false, error: 'Värdet måste vara sant eller falskt.' };
}

// ── Workshops (§ 18) ────────────────────────────────────────────────────────

const WORKSHOP_STATUS_VALUES = ['draft', 'active', 'archived'] as const;
export type WorkshopStatusForWrite = (typeof WORKSHOP_STATUS_VALUES)[number];

/**
 * Workshop-status. Agenten får bara skapa UTKAST — publicering är ett
 * mänskligt beslut (människa-i-loopen, § 10.1 art. 14) och görs i
 * `/education`-UI:t.
 */
export function validateWorkshopStatus(
  value: unknown
): ValidationResult<WorkshopStatusForWrite> {
  const s = asString(value);
  if (s === null || s.trim() === '') return { ok: true, value: 'draft' };
  const normalized = s.trim().toLowerCase();
  if (!WORKSHOP_STATUS_VALUES.includes(normalized as WorkshopStatusForWrite)) {
    return {
      ok: false,
      error: `status måste vara en av: ${WORKSHOP_STATUS_VALUES.join(', ')}.`
    };
  }
  return { ok: true, value: normalized as WorkshopStatusForWrite };
}

// ── Datum (delas av tasks/events/CRM/de minimis, § 33) ─────────────────────

/**
 * Valfritt datum (dag-nivå). Accepterar 'ÅÅÅÅ-MM-DD' eller full ISO-sträng
 * (trunkeras till dagen). Tomt/null → null.
 */
export function validateDateOnly(
  value: unknown,
  fieldName: string
): ValidationResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  const s = asString(value);
  if (s === null) return { ok: false, error: `${fieldName} måste vara ett datum (ÅÅÅÅ-MM-DD).` };
  const day = s.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    return { ok: false, error: `${fieldName} måste vara ett giltigt datum (ÅÅÅÅ-MM-DD).` };
  }
  return { ok: true, value: day };
}

/** Obligatorisk tidpunkt — ISO-parsbar sträng, normaliseras till UTC-ISO. */
export function validateIsoDateTime(
  value: unknown,
  fieldName: string
): ValidationResult<string> {
  const s = asString(value);
  if (s === null || s.trim() === '') {
    return { ok: false, error: `${fieldName} saknas (ange datum/tid, t.ex. 2026-09-10 14:00).` };
  }
  const ms = Date.parse(s.trim());
  if (!Number.isFinite(ms)) {
    return { ok: false, error: `${fieldName} är ingen giltig tidpunkt (använd ISO-format).` };
  }
  return { ok: true, value: new Date(ms).toISOString() };
}
