import 'server-only';
import type PocketBase from 'pocketbase';
import {
  SPARK_TESTBED_KIND_LABELS,
  isSparkId,
  sparkAcceleratorEligible,
  sparkAnonymousActorLabel,
  type SparkAssessmentSuggestion
} from '@platform/shared';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { MistralError } from '@/lib/ai/mistral';
import { draftIntroduction, suggestSolutionAssessment, type SparkAiUsage } from '@/lib/ai/spark-ai';
import { logAiUsage } from '@/lib/ai/usage';
import { indexSparkEmbeddings, type SparkIndexResult } from '@/lib/spark/ai.server';
import {
  SPARK_ACTORS,
  SPARK_MATCHES,
  SPARK_NEEDS,
  SPARK_SOLUTIONS,
  SPARK_TESTBEDS,
  loadSparkRegistry,
  normalizeSparkActor,
  normalizeSparkMatch,
  normalizeSparkNeed,
  normalizeSparkSolution,
  normalizeSparkTestbed,
  type SparkActorRow,
  type SparkSolutionRow
} from '@/lib/spark/data';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import { canManageSpark } from './spark';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * SPARK:s AI-lager (CLAUDE.md § 61.7) — bara Movexum (admin/incubator_lead/
 * coach), bara på en människas klick, aldrig av agenten. Kostnadstaket
 * (§ 9.6) prövas före varje körning och tokens loggas i `ai_usage_events`.
 *
 * AI:n FÖRESLÅR: förslaget på TRL/kategori sparas i egna fält (`ai_*`) bredvid
 * — aldrig i — Movexums bedömning, och introduktionstexten lämnas tillbaka som
 * ett utkast som ingen skickar åt användaren.
 */

type Raw = Record<string, unknown>;
const BULK_MAX = 20;

function gate<T>(actor: Actor): WriteResult<T> | null {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'AI-stödet i SPARK startas av en människa.');
  if (!canManageSpark(actor.roles)) return fail('FORBIDDEN', 'Bara Movexum-personal kan använda AI-stödet i SPARK.');
  return null;
}

function aiFail<T>(err: unknown): WriteResult<T> {
  if (err instanceof AiBudgetExceededError) return fail('STATE_TRANSITION', err.message);
  if (err instanceof MistralError) {
    if (err.status === 0) return fail('DB_ERROR', 'AI-tjänsten är inte konfigurerad (MISTRAL_API_KEY saknas på web-appen).');
    console.error('[spark-ai] mistral error', { status: err.status });
    return fail('DB_ERROR', err.status === 429 ? 'AI-tjänsten är överbelastad just nu. Försök igen om en stund.' : 'AI-tjänsten svarade inte. Försök igen.');
  }
  console.error('[spark-ai] failed', { status: (err as { status?: number } | null)?.status });
  return fail('DB_ERROR', 'Kunde inte slutföra AI-körningen. Försök igen.');
}

async function logUsage(pb: PocketBase, actor: Actor, usage: SparkAiUsage): Promise<void> {
  await logAiUsage(pb, { tenant: actor.tenant, userId: actor.id, surface: 'suggestions', model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut });
}

async function loadSolution(pb: PocketBase, actor: Actor, id: string): Promise<{ solution: SparkSolutionRow; owner: SparkActorRow } | null> {
  if (!isSparkId(id)) return null;
  const raw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_SOLUTIONS, id, '*');
  if (!raw) return null;
  const solution = normalizeSparkSolution(raw as unknown as Raw);
  const ownerRaw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_ACTORS, solution.actor, '*');
  if (!ownerRaw) return null;
  return { solution, owner: normalizeSparkActor(ownerRaw as unknown as Raw) };
}

async function assessOne(pb: PocketBase, actor: Actor, solution: SparkSolutionRow): Promise<SparkAssessmentSuggestion | null> {
  const { suggestion, usage } = await suggestSolutionAssessment({
    name: solution.name,
    description: solution.description,
    problem: solution.problem,
    areas: solution.areas,
    maturity: solution.maturity,
    trl: solution.trl,
    verified: solution.verified,
    needs: solution.needs,
    barriers: solution.barriers,
    expansion: solution.expansion
  });
  await logUsage(pb, actor, usage);
  if (!suggestion) return null;
  await writeWithFallback(
    pb,
    (c) =>
      c.collection(SPARK_SOLUTIONS).update(solution.id, {
        ai_trl: suggestion.trl ?? 0,
        ai_category: suggestion.category ?? '',
        ai_rationale: suggestion.rationale,
        ai_confidence: suggestion.confidence,
        ai_model: usage.model,
        ai_suggested_at: new Date().toISOString()
      }),
    { fallbackOn404: true }
  );
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_SOLUTIONS,
    record_id: solution.id,
    field: 'ai_suggestion',
    after_value: { label: solution.name, ai_trl: suggestion.trl, ai_category: suggestion.category, model: usage.model }
  });
  return suggestion;
}

/** AI:ns förslag på TRL och kategori för EN lösning. Sparas som förslag — Movexums bedömning rörs inte. */
export async function suggestSparkAssessment(pb: PocketBase, actor: Actor, solutionId: string): Promise<WriteResult<{ suggestion: SparkAssessmentSuggestion }>> {
  const no = gate<{ suggestion: SparkAssessmentSuggestion }>(actor);
  if (no) return no;
  const loaded = await loadSolution(pb, actor, solutionId);
  if (!loaded) return fail('NOT_FOUND', 'Lösningen hittades inte.');
  if (!sparkAcceleratorEligible(loaded.owner)) {
    return fail('INVALID_VALUE', 'Bara lösningar från innovationsaktörer utanför portföljen bedöms här. Portföljbolag bedöms med IRL på bolagskortet.');
  }
  if (loaded.solution.description.trim().length < 40) return fail('INVALID_VALUE', 'Beskrivningen är för kort för en bedömning. Komplettera intervjun först.');
  try {
    await assertWithinAiBudget(pb, actor.tenant);
    const suggestion = await assessOne(pb, actor, loaded.solution);
    if (!suggestion) return fail('DB_ERROR', 'AI:n gav inget tolkbart svar. Försök igen.');
    return ok({ suggestion });
  } catch (err) {
    return aiFail(err);
  }
}

/** Förslag för alla lösningar som saknar både AI-förslag och Movexums bedömning (högst 20 per körning). */
export async function suggestSparkAssessments(pb: PocketBase, actor: Actor): Promise<WriteResult<{ done: number; skipped: number; remaining: number }>> {
  const no = gate<{ done: number; skipped: number; remaining: number }>(actor);
  if (no) return no;
  const reg = await loadSparkRegistry(pb, actor.tenant);
  if (reg.error) return fail('DB_ERROR', reg.error);
  const todo = reg.solutions.filter((s) => {
    const owner = reg.actorById.get(s.actor);
    return s.status === 'active' && owner && sparkAcceleratorEligible(owner) && !s.accelerator_category && !s.ai_suggested_at && s.description.trim().length >= 40;
  });
  let done = 0;
  let skipped = 0;
  try {
    await assertWithinAiBudget(pb, actor.tenant);
    for (const s of todo.slice(0, BULK_MAX)) {
      const suggestion = await assessOne(pb, actor, s);
      if (suggestion) done += 1;
      else skipped += 1;
    }
  } catch (err) {
    // Det som hann sparas står kvar — redovisa felet tillsammans med antalet.
    const failed = aiFail<never>(err);
    return fail('DB_ERROR', `${done} lösningar fick förslag innan körningen avbröts. ${failed.ok ? '' : failed.error}`);
  }
  return ok({ done, skipped, remaining: Math.max(0, todo.length - BULK_MAX) });
}

export interface SparkIntroDraft {
  text: string;
  /** Sant när motparten beskrivs utan namn. */
  anonymous: boolean;
  caution?: string;
}

/**
 * Utkast till introduktion till EN part i en matchning. Motparten beskrivs
 * enligt sin delningsnivå: med namn bara när den sagt ja till det, annars
 * anonymt (bransch, kommun, storlek). Har motparten sagt att ingenting får
 * delas skrivs inget utkast.
 */
export async function draftSparkIntroduction(pb: PocketBase, actor: Actor, matchId: string, recipient: 'need' | 'solution'): Promise<WriteResult<SparkIntroDraft>> {
  const no = gate<SparkIntroDraft>(actor);
  if (no) return no;
  if (!isSparkId(matchId)) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  const matchRaw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_MATCHES, matchId, '*');
  if (!matchRaw) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  const match = normalizeSparkMatch(matchRaw as unknown as Raw);
  const get = async (collection: string, id: string | null) => (id ? ((await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, collection, id, '*')) as unknown as Raw | null) : null);
  const [needRaw, solutionRaw, testbedRaw] = await Promise.all([get(SPARK_NEEDS, match.need), get(SPARK_SOLUTIONS, match.solution), get(SPARK_TESTBEDS, match.testbed)]);
  const need = needRaw ? normalizeSparkNeed(needRaw) : null;
  const solution = solutionRaw ? normalizeSparkSolution(solutionRaw) : null;
  const testbed = testbedRaw ? normalizeSparkTestbed(testbedRaw) : null;

  // Motparten = den sida mottagaren INTE är.
  const counterpartActorId = recipient === 'need' ? solution?.actor : (need?.actor ?? testbed?.actor);
  if (!counterpartActorId) return fail('INVALID_VALUE', 'Matchningen saknar en motpart att beskriva.');
  const counterpartRaw = await get(SPARK_ACTORS, counterpartActorId);
  if (!counterpartRaw) return fail('NOT_FOUND', 'Motparten hittades inte.');
  const counterpart = normalizeSparkActor(counterpartRaw);
  if (counterpart.sharing === 'none') {
    return fail('STATE_TRANSITION', `${counterpart.name} har sagt att ingenting får delas. Fråga dem först och ändra delningsnivån innan en introduktion skrivs.`);
  }
  const named = counterpart.sharing === 'named';
  const label = named ? counterpart.name : sparkAnonymousActorLabel(counterpart);

  try {
    await assertWithinAiBudget(pb, actor.tenant);
    const { text, usage } = await draftIntroduction({
      recipient,
      counterpart: label,
      anonymous: !named,
      // Mottagaren får läsa om MOTPARTENS sak; sin egen känner den redan.
      need: need ? { title: need.title, description: recipient === 'solution' ? need.description : '' } : undefined,
      solution: solution
        ? { name: named || recipient === 'solution' ? solution.name : undefined, description: recipient === 'need' ? solution.description : '', problem: recipient === 'need' ? solution.problem : '' }
        : undefined,
      testbed: testbed ? { kind: SPARK_TESTBED_KIND_LABELS[testbed.kind], description: recipient === 'solution' ? testbed.description : '' } : undefined,
      reasons: match.reasons
    });
    await logUsage(pb, actor, usage);
    if (!text) return fail('DB_ERROR', 'AI:n gav inget utkast. Försök igen.');
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: SPARK_MATCHES,
      record_id: match.id,
      field: 'intro_draft',
      after_value: { recipient, anonymous: !named, length: text.length, model: usage.model }
    });
    return ok({
      text,
      anonymous: !named,
      caution: named
        ? undefined
        : counterpart.sharing === 'anonymous'
          ? 'Motparten vill vara anonym. Läs igenom så att texten inte röjer vem det är.'
          : 'Motparten har inte angett vad som får delas — beskrivs anonymt. Fråga innan namnet nämns.'
    });
  } catch (err) {
    return aiFail(err);
  }
}

/** Bygger eller uppdaterar likhetsindexet för öppna behov och aktiva lösningar. */
export async function reindexSparkEmbeddings(pb: PocketBase, actor: Actor): Promise<WriteResult<SparkIndexResult>> {
  const no = gate<SparkIndexResult>(actor);
  if (no) return no;
  const reg = await loadSparkRegistry(pb, actor.tenant);
  if (reg.error) return fail('DB_ERROR', reg.error);
  try {
    await assertWithinAiBudget(pb, actor.tenant);
    const res = await indexSparkEmbeddings(
      pb,
      { tenant: actor.tenant, userId: actor.id },
      { needs: reg.needs.filter((n) => n.status === 'open' || n.status === 'matched'), solutions: reg.solutions.filter((s) => s.status === 'active') }
    );
    return ok(res);
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 404) return fail('DB_ERROR', 'AI-lagret saknas i databasen — kör migration 1700000224 (eller workflowen "Sync PocketBase").');
    return aiFail(err);
  }
}
