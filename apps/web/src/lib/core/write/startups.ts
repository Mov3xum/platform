import 'server-only';
import type PocketBase from 'pocketbase';
import { canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateIrlLevel,
  validateNextStep,
  validatePhase,
  validateStatus,
  validateNonEmptyText,
  validateOptionalText
} from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';
import { writeWithFallback } from './helpers';
import {
  isEmptyScreeningFacts,
  normalizeScreeningFacts,
  summarizeScreeningFacts,
  type ScreeningManualFacts
} from '@platform/shared';

/**
 * Skrivbara fält på `startups` via det delade lagret. Källa av sanning
 * för whitelisten är `writable-fields.ts` — denna union är bara den
 * statiska TS-projektionen för att fånga fel kompileringstid.
 */
export type StartupWritableField =
  | 'next_step'
  | 'irl_level'
  | 'phase'
  | 'status'
  | 'name'
  | 'description'
  | 'tags';

export interface UpdateStartupFieldParams {
  startupId: string;
  field: StartupWritableField;
  value: unknown;
}

interface StartupRow extends Record<string, unknown> {
  tenant?: string;
  next_step?: string | null;
  irl_level?: number | null;
  phase?: string | null;
  status?: string | null;
  name?: string | null;
  description?: string | null;
  tags?: string | null;
  screening_facts?: unknown;
}

function normalizeValue(
  field: StartupWritableField,
  value: unknown
):
  | { ok: true; normalized: string | number | null }
  | { ok: false; error: string } {
  switch (field) {
    case 'next_step': {
      const r = validateNextStep(value);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'irl_level': {
      const r = validateIrlLevel(value);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'phase': {
      const r = validatePhase(value);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'status': {
      const r = validateStatus(value);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'name': {
      const r = validateNonEmptyText(value, 'name', 200);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'description': {
      const r = validateOptionalText(value, 'description', 2000);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
    case 'tags': {
      const r = validateOptionalText(value, 'tags', 500);
      return r.ok ? { ok: true, normalized: r.value } : { ok: false, error: r.error };
    }
  }
}

export interface UpdateStartupFieldResult {
  startupId: string;
  field: StartupWritableField;
  before: unknown;
  after: unknown;
}

/**
 * Uppdaterar ett enskilt skrivbart fält på en startup. Enda vägen att
 * skriva till `startups` — `lib/actions/startups.ts` anropar denna
 * funktion per ändrat fält, och AI-agentens `update_startup_field`-tool
 * anropar samma funktion med `actor.kind = 'agent'`.
 *
 * Garantier:
 * - Whitelist-check (människa/agent)
 * - Tenant-isolering
 * - Värdevalidering
 * - Audit-loggning i `agent_actions` (även mänskliga skrivningar)
 */
export async function updateStartupField(
  pb: PocketBase,
  actor: Actor,
  params: UpdateStartupFieldParams
): Promise<WriteResult<UpdateStartupFieldResult>> {
  const policy = canWriteField(actor, 'startups', params.field);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skrivning nekad.'
    );
  }

  const normalized = normalizeValue(params.field, params.value);
  if (!normalized.ok) {
    return fail('INVALID_VALUE', normalized.error);
  }

  let current: StartupRow;
  try {
    current = (await pb.collection('startups').getOne(params.startupId, {
      fields: `id,tenant,${params.field}`
    })) as StartupRow;
  } catch {
    return fail('NOT_FOUND', 'Bolaget hittades inte.');
  }

  if (current.tenant !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Åtkomst nekad — bolaget tillhör en annan tenant.');
  }

  const before = current[params.field] ?? null;
  const after = normalized.normalized;

  // No-op: don't bother writing or logging
  if (before === after) {
    return ok({ startupId: params.startupId, field: params.field, before, after });
  }

  try {
    await pb.collection('startups').update(params.startupId, {
      [params.field]: after
    });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'DB-uppdatering misslyckades.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'startups',
    record_id: params.startupId,
    field: params.field,
    before_value: before,
    after_value: after
  });

  return ok({ startupId: params.startupId, field: params.field, before, after });
}

// ─── Bedömning excellens: manuella svar (§ 51.4) ─────────────────────────────

export interface SaveScreeningFactsResult {
  startupId: string;
  /** Fältet saknas i schemat (migration 1700000190 inte körd) — inget sparades. */
  schemaMissing: boolean;
}

/**
 * Sparar controllerns manuella svar (`startups.screening_facts`, json) så
 * nästa körning av Bedömning excellens återanvänder dem. Svaren är redan
 * normaliserade/sanerade av `normalizeScreeningFacts` (ren modul); här
 * enforce:as whitelist (människa i modulens krets, aldrig agent), tenant och
 * audit. Auditen bär BARA antal besvarade punkter — aldrig namn, procent
 * eller motiveringstext. Posten läses tillbaka efter skrivningen: PB släpper
 * okända fält tyst (§ 24.4), så ett saknat fält rapporteras i stället för en
 * tyst lyckad no-op.
 */
export async function saveStartupScreeningFacts(
  pb: PocketBase,
  actor: Actor,
  params: { startupId: string; facts: ScreeningManualFacts }
): Promise<WriteResult<SaveScreeningFactsResult>> {
  const policy = canWriteField(actor, 'startups', 'screening_facts');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');

  let current: StartupRow;
  try {
    current = (await pb.collection('startups').getOne(params.startupId, { fields: 'id,tenant,screening_facts' })) as StartupRow;
  } catch {
    return fail('NOT_FOUND', 'Bolaget hittades inte.');
  }
  if (current.tenant !== actor.tenant) return fail('TENANT_MISMATCH', 'Åtkomst nekad — bolaget tillhör en annan tenant.');

  const facts = normalizeScreeningFacts(params.facts);
  const value = isEmptyScreeningFacts(facts) ? null : facts;
  let after: Record<string, unknown>;
  try {
    after = await writeWithFallback(pb, (client) =>
      client.collection('startups').update(params.startupId, { screening_facts: value }, { fields: 'id,screening_facts' })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'DB-uppdatering misslyckades.');
  }
  const schemaMissing = value !== null && (after.screening_facts === undefined || after.screening_facts === null);

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'startups',
    record_id: params.startupId,
    field: 'screening_facts',
    before_value: summarizeScreeningFacts(normalizeScreeningFacts(current.screening_facts)),
    after_value: { ...summarizeScreeningFacts(facts), schema_missing: schemaMissing }
  });

  return ok({ startupId: params.startupId, schemaMissing });
}
