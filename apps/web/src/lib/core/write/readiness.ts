import 'server-only';
import type PocketBase from 'pocketbase';
import {
  KTH_IRL_AXES,
  planIrlPromotion,
  summarizeIrl,
  validateIrlAssessmentInput,
  type IrlAssessmentInput,
  type ScreeningManualFacts
} from '@platform/shared';
import { loadLatestIrlReading } from '@/lib/irl/data.server';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import { fail, ok, type Actor, type WriteResult } from './types';

/**
 * KTH Innovation Readiness Level på bolagskortet (`/startups/[id]/utveckling`).
 * En ny bedömning = en ny rad i `startup_readiness_assessments` (tidsserie,
 * migration 1700000104 + 1700000193) — tidigare bedömningar skrivs aldrig
 * över, så progressionen går att följa. Axlarna och valideringen bor i
 * `packages/shared/src/kth-irl.ts`; samma rad läses av Vinnovas
 * lägesredovisning och Bedömning excellens (crl/tmrl/brl/srl).
 *
 * RBAC: Movexum-personalen (admin/incubator_lead/coach/mentor, speglar
 * kollektionens update-/deleteRule) — agenten har inget verktyg.
 * Audit: talen + antal motiveringar (aldrig fritexten).
 */

export interface CreateReadinessResult {
  id: string;
  /** Fält som saknas i schemat (migration 1700000193 inte körd). */
  schemaMissing: string[];
}

function todayStockholm(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export async function createReadinessAssessment(
  pb: PocketBase,
  actor: Actor,
  params: { startupId: string; input: IrlAssessmentInput }
): Promise<WriteResult<CreateReadinessResult>> {
  const policy = canCreateRecord(actor, 'startup_readiness_assessments');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');

  const startup = await getRecordInTenant<{ id: string; tenant: string; name: string }>(
    pb,
    actor,
    'startups',
    params.startupId,
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const today = todayStockholm();
  const parsed = validateIrlAssessmentInput(params.input, today);
  if (!parsed.ok) return fail('INVALID_VALUE', parsed.error);
  const v = parsed.value;

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    startup: startup.id,
    // Dagens bedömning får klockslaget nu, så två bedömningar samma dag
    // sorteras rätt (tidsserien sorteras på assessed_at).
    assessed_at: v.assessedAt === today ? new Date().toISOString() : `${v.assessedAt} 12:00:00.000Z`,
    assessed_by: actor.id,
    note: v.note,
    srl: v.srl,
    axis_notes: Object.keys(v.axisNotes).length > 0 ? v.axisNotes : null
  };
  for (const axis of KTH_IRL_AXES) payload[axis.key] = v.profile[axis.key] ?? null;

  let created: Record<string, unknown>;
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection('startup_readiness_assessments').create(payload)
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara bedömningen.');
  }

  // PB släpper okända fält tyst (§ 24.4) — rapportera vilka som inte fastnade.
  const schemaMissing = (['trl', 'iprl', 'frl', 'axis_notes'] as const).filter(
    (f) => payload[f] !== null && payload[f] !== undefined && !(f in created)
  );

  const summary = summarizeIrl(v.profile);
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'startup_readiness_assessments',
    record_id: String(created.id),
    after_value: {
      startup: startup.id,
      startup_name: startup.name,
      assessed_at: v.assessedAt,
      levels: v.profile,
      srl: v.srl,
      average: summary.average,
      axis_notes: Object.keys(v.axisNotes).length,
      schema_missing: schemaMissing.length > 0 ? schemaMissing : undefined
    }
  });

  return ok({ id: String(created.id), schemaMissing });
}

export interface PromotedIrl {
  /** Svaren utan det som nu bor i bolagskortets bedömning. */
  facts: ScreeningManualFacts;
  /** En ny bedömning skrevs på bolagskortet. */
  promoted: boolean;
  /** Varför IRL-svaren inte kunde flyttas (de ligger då kvar i svaren). */
  error?: string;
}

/**
 * IRL har EN plats: bolagskortets KTH-bedömning (§ 52.2). IRL-nivåer och
 * motiveringar som anges i Bedömning excellens (rapporten eller en begäran
 * om komplettering, § 51.4/§ 51.6) skrivs dit som en ny bedömning —
 * ovanpå den senaste, och bara när något faktiskt ändrats
 * (`planIrlPromotion`) — och tas bort ur `screening_facts`, så samma
 * uppgift aldrig finns i två versioner. Bara Movexum-personal kan
 * bedöma (samma policy som bolagskortet); för andra, och vid fel, ligger
 * svaren kvar oförändrade. Fail-soft.
 */
export async function promoteScreeningIrl(
  pb: PocketBase,
  actor: Actor,
  startupId: string,
  facts: ScreeningManualFacts
): Promise<PromotedIrl> {
  if (!facts.irl || (!facts.irl.levels && !facts.irl.notes)) return { facts, promoted: false };
  if (actor.kind !== 'user' || !canCreateRecord(actor, 'startup_readiness_assessments').ok) return { facts, promoted: false };
  let latest;
  try {
    latest = await loadLatestIrlReading(pb, actor.tenant, startupId);
  } catch {
    // Kan den nuvarande bedömningen inte läsas skrivs ingen ny (den kunde skriva över nyare nivåer).
    return { facts, promoted: false, error: 'IRL på bolagskortet kunde inte läsas — nivåerna sparades i svaren.' };
  }
  const plan = planIrlPromotion(latest, facts.irl);
  const strip = (): ScreeningManualFacts => {
    const next: ScreeningManualFacts = { ...facts };
    if (plan.remaining) next.irl = plan.remaining;
    else delete next.irl;
    return next;
  };
  if (!plan.write) return { facts: strip(), promoted: false };
  const res = await createReadinessAssessment(pb, actor, {
    startupId,
    input: {
      levels: plan.write.profile as Record<string, unknown>,
      srl: plan.write.srl,
      axisNotes: plan.write.axisNotes as Record<string, unknown>,
      note: 'Registrerad via Bedömning excellens.'
    }
  });
  if (!res.ok) return { facts, promoted: false, error: `IRL kunde inte sparas på bolagskortet: ${res.error}` };
  return { facts: strip(), promoted: true };
}
