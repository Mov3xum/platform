import 'server-only';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';

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
