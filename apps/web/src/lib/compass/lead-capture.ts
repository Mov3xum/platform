import 'server-only';
import type PocketBase from 'pocketbase';
import {
  cleanContactValues,
  contactSectionForModule,
  isSurveyModule,
  missingContactField,
  type ContactSectionConfig,
  type ContactValues
} from '@platform/shared';
import { summarizeSubmission, type SubmissionEntry } from './chat';
import { createConversation, createLead, findConversationBySession, patchConversation, updateLead } from './store';
import { assertWithinAiBudget } from '@/lib/ai/budget.server';
import { logAiUsage } from '@/lib/ai/usage';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { countSessionAttachments, linkSessionAttachments } from './attachments';
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

/**
 * Avsnittet "Dina uppgifter" (§ 23.11) server-side: modulens konfiguration
 * (lagrad eller legacy), besökarens värden tvättade mot den (dolda fält
 * släpps, fasta val valideras, fritext saneras) och första saknade
 * obligatoriska fält. Klienten är aldrig gränsen — samma rena funktioner
 * som avsnittet i webbläsaren använder.
 */
export function parseContactSubmission(
  module: Pick<CompassModule, 'flow_type' | 'contact_fields' | 'require_email' | 'require_phone' | 'require_organization'>,
  raw: unknown,
  opts: { attachmentCount?: number } = {}
): { config: ContactSectionConfig; values: ContactValues; error: string | null } {
  const config = contactSectionForModule(module);
  // Antalet bilagor tas ALDRIG från klienten (§ 23.12): publika routar räknar
  // sessionens uppladdade filer i databasen. Utan räkning (admin-preview, som
  // inte laddar upp) hoppas bilagekravet över.
  const rec = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  if (opts.attachmentCount !== undefined) rec.attachments = String(opts.attachmentCount);
  const values = cleanContactValues(rec, config);
  const effective =
    opts.attachmentCount === undefined && config.attachments === 'required'
      ? { ...config, attachments: 'optional' as const }
      : config;
  return { config, values, error: missingContactField(values, effective) };
}

/**
 * `parseContactSubmission` för de publika routarna: räknar sessionens
 * bilagor server-side först (bara när modulen visar bilagefältet).
 */
export async function parsePublicContactSubmission(
  module: Pick<CompassModule, 'flow_type' | 'contact_fields' | 'require_email' | 'require_phone' | 'require_organization'>,
  raw: unknown,
  ctx: { tenant: string; moduleSlug: string; sessionToken?: string | null }
): Promise<{ config: ContactSectionConfig; values: ContactValues; error: string | null }> {
  const config = contactSectionForModule(module);
  const attachmentCount =
    config.attachments === 'hidden'
      ? 0
      : await countSessionAttachments(ctx.tenant, ctx.moduleSlug, ctx.sessionToken);
  return parseContactSubmission(module, raw, { attachmentCount });
}

/**
 * Lead-fält ur avsnittet. Avsnittets värden vinner över det som mappats ur
 * frågorna (`mapAnswersToLead`) — besökaren fyllde i dem sist och medvetet.
 * Tomma värden skriver aldrig över något (finalizeLead släpper dem).
 */
export function leadFieldsFromContact(values: ContactValues): Partial<Lead> {
  const out: Partial<Lead> = {};
  if (values.name) out.name = values.name;
  if (values.email) out.email = values.email;
  if (values.phone) out.phone = values.phone;
  if (values.organization) out.organization = values.organization;
  if (values.founder_gender) out.founder_gender = values.founder_gender as Lead['founder_gender'];
  if (values.team_members) out.team_members = values.team_members;
  if (values.kommun) out.kommun = values.kommun;
  if (values.referral_channel) out.referral_channel = values.referral_channel;
  if (values.website) out.website = values.website;
  if (values.other_info) out.other_info = values.other_info;
  return out;
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
 *
 * Token-utfallet loggas i `ai_usage_events` (surface `suggestions`, § 9.6) med
 * `pb` — för de publika routarna är det superuser-klienten och raden blir
 * anonym (`userId` utelämnas, migration 1700000185); de interna preview-
 * routarna skickar den inloggades id (createRule kräver `user = auth.id`).
 */
const SUMMARY_MAX_PER_TENANT_HOUR = 200;

export async function attachAiSummary(
  pb: PocketBase,
  tenant: string,
  lead: Lead,
  entries: SubmissionEntry[],
  moduleName: string,
  resultLine?: string,
  actor: { userId?: string | null } = {}
): Promise<string | undefined> {
  // Kostnadsskydd: de publika routarna rate-limitas per IP, men en roterad
  // IP-pool skulle annars kunna driva obegränsade Mistral-anrop på tenantens
  // nyckel. Tak per tenant/timme + månadstaket (§ 9.6) innan modellanropet.
  // Leadet är redan skapat — en hoppad sammanställning tappar aldrig inflödet.
  const tenantKey = `lead-summary:${tenant}`;
  if ((await checkRateLimit(tenantKey, SUMMARY_MAX_PER_TENANT_HOUR)).blocked) return undefined;
  await recordFailure(tenantKey, 60 * 60 * 1000);
  try {
    await assertWithinAiBudget(pb, tenant);
    const { summary, usage } = await summarizeSubmission(entries, moduleName, resultLine);
    if (usage) {
      await logAiUsage(pb, {
        tenant,
        userId: actor.userId ?? null,
        surface: 'suggestions',
        model: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut
      });
    }
    if (!summary) return undefined;
    await updateLead(pb, tenant, lead.id, { ai_summary: summary });
    return summary;
  } catch {
    return undefined;
  }
}

/**
 * Slutför ett flöde till EN lead (§ 23.10). Finns en session-konversation
 * med ett pågående lead (progress-upsert i formulär/quiz, tur-upsert i
 * chatten) uppdateras DET leadet till `completed` — annars skapas ett nytt
 * slutfört lead och en konversation. Sessionstoken är valfri (äldre klienter
 * och admin-previewen skickar ingen → skapa som förut). Returnerar null bara
 * när leadet varken kunde uppdateras eller skapas (hård lead-garanti § 23.6).
 */
export async function finalizeLead(
  pb: PocketBase,
  tenant: string,
  input: {
    moduleSlug: string;
    sessionToken?: string | null;
    fields: Partial<Lead>;
  }
): Promise<{ lead: Lead; created: boolean } | null> {
  const token = input.sessionToken && /^[A-Za-z0-9_-]{16,100}$/.test(input.sessionToken) ? input.sessionToken : null;
  const existing = token ? await findConversationBySession(pb, tenant, input.moduleSlug, token) : null;
  // Fält som den slutförande inskickningen ALLTID bestämmer; tomma värden
  // får inte skriva över det AI-extraktionen redan fyllt i (chatt).
  const patch: Partial<Lead> = { completion: 'completed' };
  for (const [k, v] of Object.entries(input.fields)) {
    if (v === undefined || v === null || v === '') continue;
    (patch as Record<string, unknown>)[k] = v;
  }
  // Ett uttryckligt tomt `notes` rensar progress-noten ("Påbörjade formuläret:
  // 2 av 5 frågor besvarade") när flödet slutförs — chatten skickar inget
  // `notes` och behåller sin samtalsnot.
  if (input.fields.notes === '') patch.notes = '';
  if (existing?.lead) {
    const updated = await updateLead(pb, tenant, existing.lead, patch);
    if (updated) {
      await patchConversation(pb, existing.id, { status: 'completed' });
      await linkSessionAttachments(tenant, input.moduleSlug, token, updated.id);
      return { lead: updated, created: false };
    }
    // Leadet försvann (raderat av personal) — skapa ett nytt nedan.
  }
  const lead = await createLead(pb, tenant, { ...input.fields, completion: 'completed' });
  if (!lead) return null;
  if (existing) {
    await patchConversation(pb, existing.id, { status: 'completed', lead: lead.id });
  } else {
    await createConversation(pb, tenant, { moduleSlug: input.moduleSlug, sessionToken: token ?? undefined, leadId: lead.id });
  }
  // Bilagor som laddats upp under flödet (§ 23.12) följer med leadet.
  await linkSessionAttachments(tenant, input.moduleSlug, token, lead.id);
  return { lead, created: true };
}
