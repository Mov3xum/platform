import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateDateOnly,
  validateNonEmptyText,
  validateOptionalText
} from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * CRM-registreringar via chatten (§ 33): KPI:er, mottaget kapital och
 * icke-konfidentiella anteckningar. Alla poster skrivs till befintliga
 * kollektioner (§ 15) med tenant-stämpel från actorn och `agent_actions`-
 * audit. PII-skydd:
 * - `capital_rounds.notes` (syftet) personnummer-saneras på skrivvägen
 *   (samma regex som § 15.6) och cappas.
 * - `notes` skapas ALLTID med `confidential=false` — konfidentiella
 *   anteckningar skrivs av en människa i UI:t, och anteckningstexten
 *   loggas ALDRIG i `agent_actions` (bara längd).
 */

const KPI_COLLECTION = 'startup_kpis';
const CAPITAL_COLLECTION = 'capital_rounds';
const NOTES_COLLECTION = 'notes';

const CAPITAL_TYPES = ['grant', 'equity', 'loan', 'soft_funding', 'convertible', 'other'] as const;
type CapitalType = (typeof CAPITAL_TYPES)[number];

export interface AddStartupKpiParams {
  startupId: string;
  kpiName: string;
  valueText: string;
  valueNumeric?: number | null;
  unit?: string | null;
  measuredAt?: string | null;
  isCurrent?: boolean;
}

export interface AddedStartupKpiResult {
  kpiId: string;
  kpiName: string;
  startupName: string;
  startupPath: string;
}

export async function addStartupKpi(
  pb: PocketBase,
  actor: Actor,
  params: AddStartupKpiParams
): Promise<WriteResult<AddedStartupKpiResult>> {
  const policy = canCreateRecord(actor, KPI_COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const kpiName = validateNonEmptyText(params.kpiName, 'kpi_name', 100);
  if (!kpiName.ok) return fail('INVALID_VALUE', kpiName.error);
  const valueText = validateNonEmptyText(params.valueText, 'value_text', 200);
  if (!valueText.ok) return fail('INVALID_VALUE', valueText.error);
  const unit = validateOptionalText(params.unit, 'unit', 30);
  if (!unit.ok) return fail('INVALID_VALUE', unit.error);

  const measuredAt = validateDateOnly(params.measuredAt, 'measured_at');
  if (!measuredAt.ok) return fail('INVALID_VALUE', measuredAt.error);
  const measured = measuredAt.value ?? new Date().toISOString().slice(0, 10);

  let valueNumeric: number | null = null;
  if (params.valueNumeric !== undefined && params.valueNumeric !== null) {
    const n = Number(params.valueNumeric);
    if (!Number.isFinite(n)) return fail('INVALID_VALUE', 'value_numeric måste vara ett tal.');
    valueNumeric = n;
  }

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const isCurrent = params.isCurrent !== false;

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(KPI_COLLECTION).create<{ id: string }>({
        tenant: actor.tenant,
        startup: startup.id,
        kpi_name: kpiName.value,
        value_text: valueText.value,
        value_numeric: valueNumeric,
        unit: unit.value ?? '',
        measured_at: measured,
        is_current: isCurrent
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara KPI:n.');
  }

  // "Aktuellt värde"-invarianten: äldre rader med samma KPI-namn avmarkeras
  // (best-effort) så att is_current bara pekar på det senaste värdet.
  if (isCurrent) {
    try {
      const others = await pb.collection(KPI_COLLECTION).getList<{ id: string }>(1, 20, {
        filter:
          `tenant = "${escFilter(actor.tenant)}" && startup = "${escFilter(startup.id)}" && ` +
          `kpi_name = "${escFilter(kpiName.value)}" && is_current = true && id != "${escFilter(created.id)}"`,
        fields: 'id'
      });
      for (const row of others.items) {
        await writeWithFallback(pb, (client) =>
          client.collection(KPI_COLLECTION).update(row.id, { is_current: false })
        ).catch(() => undefined);
      }
    } catch {
      /* fail-soft */
    }
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: KPI_COLLECTION,
    record_id: created.id,
    after_value: {
      startup: startup.id,
      startup_name: startup.name,
      kpi_name: kpiName.value,
      value_text: valueText.value,
      unit: unit.value ?? undefined,
      measured_at: measured
    }
  });

  return ok({
    kpiId: created.id,
    kpiName: kpiName.value,
    startupName: startup.name || 'bolaget',
    startupPath: `/startups/${startup.id}`
  });
}

export interface AddCapitalRoundParams {
  startupId: string;
  type: string;
  source: string;
  amountSek: number;
  receivedAt: string;
  purpose?: string | null;
}

export interface AddedCapitalRoundResult {
  roundId: string;
  source: string;
  amountSek: number;
  startupName: string;
  startupPath: string;
}

export async function addCapitalRound(
  pb: PocketBase,
  actor: Actor,
  params: AddCapitalRoundParams
): Promise<WriteResult<AddedCapitalRoundResult>> {
  const policy = canCreateRecord(actor, CAPITAL_COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  if (!CAPITAL_TYPES.includes(params.type as CapitalType)) {
    return fail('INVALID_VALUE', `type måste vara en av: ${CAPITAL_TYPES.join(', ')}.`);
  }
  const source = validateNonEmptyText(params.source, 'source', 200);
  if (!source.ok) return fail('INVALID_VALUE', source.error);

  const amount = Number(params.amountSek);
  if (!Number.isFinite(amount) || amount < 0) {
    return fail('INVALID_VALUE', 'amount_sek måste vara ett belopp ≥ 0 (i kronor).');
  }

  const receivedAt = validateDateOnly(params.receivedAt, 'received_at');
  if (!receivedAt.ok) return fail('INVALID_VALUE', receivedAt.error);
  if (!receivedAt.value) return fail('INVALID_VALUE', 'received_at (datum) krävs.');

  const purposeRaw = validateOptionalText(params.purpose, 'purpose', 500);
  if (!purposeRaw.ok) return fail('INVALID_VALUE', purposeRaw.error);
  // Personnummer-sanering på skrivvägen (§ 15.6-regexen) — syftet är
  // lågkänsligt ("IP-strategi", "affärscoachning") men saneras ändå.
  const purpose = purposeRaw.value ? sanitizePersonnummer(purposeRaw.value) : null;

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(CAPITAL_COLLECTION).create<{ id: string }>({
        tenant: actor.tenant,
        startup: startup.id,
        type: params.type,
        source: source.value,
        amount_sek: amount,
        received_at: receivedAt.value,
        notes: purpose ?? ''
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte registrera kapitalet.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CAPITAL_COLLECTION,
    record_id: created.id,
    after_value: {
      startup: startup.id,
      startup_name: startup.name,
      type: params.type,
      source: source.value,
      amount_sek: amount,
      received_at: receivedAt.value
    }
  });

  return ok({
    roundId: created.id,
    source: source.value,
    amountSek: amount,
    startupName: startup.name || 'bolaget',
    startupPath: `/startups/${startup.id}`
  });
}

export interface CreateStartupNoteParams {
  startupId: string;
  body: string;
}

export interface CreatedStartupNoteResult {
  noteId: string;
  startupName: string;
  startupPath: string;
}

export async function createStartupNote(
  pb: PocketBase,
  actor: Actor,
  params: CreateStartupNoteParams
): Promise<WriteResult<CreatedStartupNoteResult>> {
  const policy = canCreateRecord(actor, NOTES_COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const body = validateNonEmptyText(params.body, 'body', 8000);
  if (!body.ok) return fail('INVALID_VALUE', body.error);
  // Person nr lagras ALDRIG (§ 9.4) — sanera på skrivvägen (§ 15.6-regexen);
  // verktygsbeskrivningens "skriv inga personuppgifter" är en instruktion
  // till modellen, inte en kontroll. Extra relevant vid röstinmatning (§ 31).
  const cleanBody = sanitizePersonnummer(body.value);

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(NOTES_COLLECTION).create<{ id: string }>({
        startup: startup.id,
        author: actor.id,
        body: cleanBody,
        // Chatten skriver ALDRIG konfidentiella anteckningar (§ 33).
        confidential: false
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara anteckningen.');
  }

  // Anteckningstexten loggas MEDVETET inte i audit (kan innehålla känsligt
  // innehåll) — bara att en icke-konfidentiell anteckning skapades.
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: NOTES_COLLECTION,
    record_id: created.id,
    after_value: {
      startup: startup.id,
      startup_name: startup.name,
      confidential: false,
      body_length: cleanBody.length
    }
  });

  return ok({
    noteId: created.id,
    startupName: startup.name || 'bolaget',
    startupPath: `/startups/${startup.id}`
  });
}

export { CAPITAL_TYPES };
