import 'server-only';
import {
  ALL_PHASES,
  ANNUAL_WHEEL_CATEGORY_IDS,
  ANNUAL_WHEEL_TAG_IDS,
  sanitizeDay,
  sanitizeMonth,
  type AnnualWheelCategory,
  type AnnualWheelTag,
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

export function validateAnnualWheelCategory(
  value: unknown
): ValidationResult<AnnualWheelCategory> {
  const s = asString(value);
  if (s === null) return { ok: false, error: 'category saknas.' };
  if (!ANNUAL_WHEEL_CATEGORY_IDS.includes(s as AnnualWheelCategory)) {
    return { ok: false, error: `category måste vara en av: ${ANNUAL_WHEEL_CATEGORY_IDS.join(', ')}.` };
  }
  return { ok: true, value: s as AnnualWheelCategory };
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
