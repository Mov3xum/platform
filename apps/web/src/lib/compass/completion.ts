/**
 * Genomförandestatus för Startupkompassens leads (CLAUDE.md § 23.10).
 *
 * `compass_leads.completion` (migration 1700000192) säger vad BESÖKAREN
 * gjorde — skilt från `status`, som är personalens pipeline. Ren modul
 * (ingen IO), enhetstestad i `completion.test.ts`; delas av routarna,
 * listvyn och statistiken så ingen yta räknar annorlunda.
 */

import type { CompassQuestion } from './types';

export type LeadCompletion = 'in_progress' | 'completed' | 'abandoned';

export const LEAD_COMPLETION_VALUES: LeadCompletion[] = ['in_progress', 'completed', 'abandoned'];

export const LEAD_COMPLETION_LABEL: Record<LeadCompletion, string> = {
  in_progress: 'Pågående',
  completed: 'Slutförd',
  abandoned: 'Avbruten'
};

/** Ett påbörjat flöde utan aktivitet så här länge räknas som avbrutet. */
export const ABANDON_AFTER_MS = 2 * 60 * 60 * 1000;

/** Saknat fält (oapplicerad migration) ⇒ slutförd — leads skapades förr bara vid slutförande. */
export function normalizeLeadCompletion(value: unknown): LeadCompletion {
  return value === 'in_progress' || value === 'abandoned' ? value : 'completed';
}

export function isLeadCompletion(value: unknown): value is LeadCompletion {
  return value === 'in_progress' || value === 'completed' || value === 'abandoned';
}

/** Räknas leadet i tratt/KPI:er? Bara slutförda — ett avbrutet flöde är ingen ansökan. */
export function countsInStatistics(completion: unknown): boolean {
  return normalizeLeadCompletion(completion) === 'completed';
}

/** Ett pågående lead vars senaste aktivitet ligger längre bak än `ABANDON_AFTER_MS`. */
export function isStaleInProgress(
  lead: { completion?: unknown; updated?: string; created?: string },
  nowMs: number,
  afterMs: number = ABANDON_AFTER_MS
): boolean {
  if (normalizeLeadCompletion(lead.completion) !== 'in_progress') return false;
  const stamp = lead.updated || lead.created;
  if (!stamp) return false;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t > afterMs;
}

/** Frågorna som chattens avslutssteg ställer: modulens obligatoriska. */
export function closingQuestions(questions: CompassQuestion[]): CompassQuestion[] {
  return questions.filter((q) => q.required);
}

export interface ClosingContact {
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
}

export interface ClosingRequirements {
  requireEmail?: boolean;
  requirePhone?: boolean;
  requireOrganization?: boolean;
}

function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Första saknade obligatoriska uppgiften i chattens avslutssteg, som ett
 * svenskt felmeddelande — eller null när allt är ifyllt. Samma kontroll körs
 * i klienten (direkt feedback) och server-side (klienten är aldrig gränsen).
 */
export function missingClosingField(input: {
  questions: CompassQuestion[];
  answers: Record<string, string | string[]>;
  contact: ClosingContact;
  requirements: ClosingRequirements;
}): string | null {
  for (const q of closingQuestions(input.questions)) {
    if (!isAnswered(input.answers[q.key])) return `Fältet "${q.prompt}" är obligatoriskt.`;
  }
  const { contact, requirements } = input;
  if (requirements.requireEmail && !isAnswered(contact.email)) return 'E-post krävs.';
  if (requirements.requirePhone && !isAnswered(contact.phone)) return 'Telefon krävs.';
  if (requirements.requireOrganization && !isAnswered(contact.organization)) {
    return 'Organisation krävs.';
  }
  return null;
}

/** PII-fri notering om var i flödet besökaren var när hen lämnade. */
export function progressNote(input: { step: number; total: number; flow: string }): string {
  const step = Math.max(0, Math.floor(input.step));
  const total = Math.max(0, Math.floor(input.total));
  if (total <= 0) return `Påbörjade ${input.flow}.`;
  return `Påbörjade ${input.flow}: ${Math.min(step, total)} av ${total} frågor besvarade.`;
}
