import 'server-only';
import type PocketBase from 'pocketbase';
import { isSurveyModule } from '@platform/shared';
import { summarizeSubmission, type SubmissionEntry } from './chat';
import { updateLead } from './store';
import { assertWithinAiBudget } from '@/lib/ai/budget.server';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type { CompassModule, CompassQuestion, ContactPreference, Lead } from './types';

/* ────────────────────────────────────────────────────────────────────
   Delad lead-fångst-kärna (CLAUDE.md § 23.6 — ingen divergerande kopia)
   ────────────────────────────────────────────────────────────────────
   Delas av de publika intag-routarna (/api/public/m/[slug]/{submit,quiz-result})
   och admin-previewens interna motsvarigheter (/api/inflode/m/[slug]/*).
   Här bor: modulens lead-toggle (steg 4), kontaktpreferens-valideringen och
   AI-sammanställningen av det inskickade. */

/**
 * Steg 4-valet "Skapa lead i Startupkompassen". SAKNAT fält (instans där
 * migration 1700000125 inte applicerats ännu) tolkas som true — bara ett
 * uttryckligt false stänger av lead-skapandet, så en oapplicerad migration
 * aldrig tyst tappar inflöden.
 */
export function moduleWantsLead(module: Pick<CompassModule, 'create_lead' | 'purpose'>): boolean {
  // En ENKÄT (§ 43) skapar aldrig lead — svaren lagras per fråga i stället.
  if (isSurveyModule(module)) return false;
  return module.create_lead !== false;
}

/** Validerar besökarens kontaktpreferens — okända värden släpps aldrig in. */
export function parseContactPreference(v: unknown): ContactPreference | undefined {
  return v === 'contact_me' || v === 'self_reach' ? v : undefined;
}

/**
 * Bygger fråga/svar-par för AI-sammanställningen. Svarsvärden mappas till
 * sina läsbara alternativ-etiketter när frågan har choices, så modellen ser
 * det besökaren faktiskt valde (inte interna value-slugs).
 */
export function buildSubmissionEntries(
  questions: CompassQuestion[],
  answers: Record<string, string | string[]>
): SubmissionEntry[] {
  const entries: SubmissionEntry[] = [];
  for (const q of questions) {
    const raw = answers[q.key];
    if (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const labelOf = (v: string): string =>
      q.choices?.find((c) => c.value === v)?.label || v;
    const answer = values
      .map((v) => (typeof v === 'string' ? labelOf(v) : ''))
      .filter(Boolean)
      .join(', ')
      .slice(0, 2000);
    if (answer) entries.push({ question: q.prompt.slice(0, 300), answer });
  }
  return entries;
}

/**
 * Genererar AI-sammanställningen och skriver den på leadet. Best-effort —
 * misslyckad AI/skrivning blockerar aldrig leadet (det är redan skapat) och
 * sväljs tyst. Returnerar sammanställningen så att anroparen kan inkludera
 * den i inflödesnotisen.
 */
const SUMMARY_MAX_PER_TENANT_HOUR = 200;

export async function attachAiSummary(
  pb: PocketBase,
  tenant: string,
  lead: Lead,
  entries: SubmissionEntry[],
  moduleName: string,
  resultLine?: string
): Promise<string | undefined> {
  // Kostnadsskydd: de publika routarna rate-limitas per IP, men en roterad
  // IP-pool skulle annars kunna driva obegränsade Mistral-anrop på tenantens
  // nyckel. Tak per tenant/timme + månadstaket (§ 9.6) innan modellanropet.
  // Leadet är redan skapat — en hoppad sammanställning tappar aldrig inflödet.
  const tenantKey = `lead-summary:${tenant}`;
  if (checkRateLimit(tenantKey, SUMMARY_MAX_PER_TENANT_HOUR).blocked) return undefined;
  recordFailure(tenantKey, 60 * 60 * 1000);
  try {
    await assertWithinAiBudget(pb, tenant);
    const summary = await summarizeSubmission(entries, moduleName, resultLine);
    if (!summary) return undefined;
    await updateLead(pb, tenant, lead.id, { ai_summary: summary });
    return summary;
  } catch {
    return undefined;
  }
}
