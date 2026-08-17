import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateAnnualWheelCategory,
  validateAnnualWheelDay,
  validateAnnualWheelMonth,
  validateAnnualWheelTrack,
  validateNonEmptyText,
  validateOptionalText,
  validateYear
} from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';
import { listAnnualWheelCategoryKeys } from '@/lib/annual-wheel/categories';

const COLLECTION = 'annual_wheel_items';
const PB_ID = PB_COLLECTIONS.annualWheelItems;

/**
 * Kategorierna är dynamiska per tenant (§ 30) → nyckeln måste finnas i
 * tenantens `annual_wheel_categories`. Validatorn har redan kontrollerat
 * FORMATET; detta är existens-kontrollen. Gäller både människa och agent, så
 * modellen inte kan hitta på en egen kategori (fältet är fritext i PB).
 */
async function assertCategoryExists(
  pb: PocketBase,
  actor: Actor,
  key: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const keys = await listAnnualWheelCategoryKeys(pb, actor.tenant);
  if (keys.includes(key)) return { ok: true };
  return {
    ok: false,
    error: `Okänd kategori '${key}'. Giltiga kategorier: ${keys.join(', ')}.`
  };
}

export interface CreateAnnualWheelItemParams {
  year: number;
  title: string;
  month?: number | null;
  day?: number | null;
  track: string;
  category: string;
  notes?: string;
}

export interface CreatedAnnualWheelItemResult {
  itemId: string;
  year: number;
  title: string;
}

/**
 * Skapar en årshjuls-post via det delade lagret (UI-action OCH agent-chatt går
 * härigenom). Tenant stämplas från actorn — aldrig från klienten — och varje
 * skrivning loggas i `agent_actions`. Ingen PII (intern verksamhetsplanering).
 */
export async function createAnnualWheelItem(
  pb: PocketBase,
  actor: Actor,
  params: CreateAnnualWheelItemParams
): Promise<WriteResult<CreatedAnnualWheelItemResult>> {
  const createPolicy = canCreateRecord(actor, COLLECTION);
  if (!createPolicy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      createPolicy.reason ?? 'Skapande nekat.'
    );
  }

  const year = validateYear(params.year);
  if (!year.ok) return fail('INVALID_VALUE', year.error);

  const title = validateNonEmptyText(params.title, 'title', 200);
  if (!title.ok) return fail('INVALID_VALUE', title.error);

  const month = validateAnnualWheelMonth(params.month);
  if (!month.ok) return fail('INVALID_VALUE', month.error);

  const day = validateAnnualWheelDay(params.day);
  if (!day.ok) return fail('INVALID_VALUE', day.error);

  const track = validateAnnualWheelTrack(params.track);
  if (!track.ok) return fail('INVALID_VALUE', track.error);

  const category = validateAnnualWheelCategory(params.category);
  if (!category.ok) return fail('INVALID_VALUE', category.error);

  const categoryExists = await assertCategoryExists(pb, actor, category.value);
  if (!categoryExists.ok) return fail('INVALID_VALUE', categoryExists.error);

  const notes = validateOptionalText(params.notes, 'notes', 2000);
  if (!notes.ok) return fail('INVALID_VALUE', notes.error);

  // En dag utan månad är meningslös (hjulet placerar per månad) → nollställ.
  const effectiveDay = month.value === null ? null : day.value;
  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    year: year.value,
    title: title.value,
    month: month.value === null ? null : month.value,
    day: effectiveDay,
    track: track.value,
    category: category.value,
    created_by: actor.id
  };
  if (notes.value) payload.notes = notes.value;

  let created: { id: string };
  try {
    created = (await pb.collection(PB_ID).create(payload)) as { id: string };
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa årshjuls-post.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: COLLECTION,
    record_id: created.id,
    after_value: {
      year: year.value,
      title: title.value,
      month: month.value,
      day: effectiveDay,
      track: track.value,
      category: category.value
    }
  });

  return ok({ itemId: created.id, year: year.value, title: title.value });
}

export type AnnualWheelWritableField =
  | 'title'
  | 'month'
  | 'day'
  | 'track'
  | 'category'
  | 'notes'
  | 'year';

export interface UpdateAnnualWheelItemFieldParams {
  itemId: string;
  field: AnnualWheelWritableField;
  value: unknown;
}

interface AnnualWheelRow extends Record<string, unknown> {
  tenant?: string;
}

/** Uppdaterar ETT fält på en årshjuls-post (tenant-verifierat + audit-loggat). */
export async function updateAnnualWheelItemField(
  pb: PocketBase,
  actor: Actor,
  params: UpdateAnnualWheelItemFieldParams
): Promise<WriteResult<{ itemId: string; field: string; before: unknown; after: unknown }>> {
  const policy = canWriteField(actor, COLLECTION, params.field);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skrivning nekad.'
    );
  }

  let normalized: string | number | null;
  switch (params.field) {
    case 'title': {
      const r = validateNonEmptyText(params.value, 'title', 200);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'notes': {
      const r = validateOptionalText(params.value, 'notes', 2000);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'month': {
      const r = validateAnnualWheelMonth(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'day': {
      const r = validateAnnualWheelDay(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'track': {
      const r = validateAnnualWheelTrack(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'category': {
      const r = validateAnnualWheelCategory(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      const exists = await assertCategoryExists(pb, actor, r.value);
      if (!exists.ok) return fail('INVALID_VALUE', exists.error);
      normalized = r.value;
      break;
    }
    case 'year': {
      const r = validateYear(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    default:
      return fail('FIELD_NOT_WRITABLE', `Fältet '${params.field}' är inte skrivbart.`);
  }

  let current: AnnualWheelRow;
  try {
    current = (await pb
      .collection(PB_ID)
      .getOne(params.itemId, { fields: `id,tenant,${params.field}` })) as AnnualWheelRow;
  } catch {
    return fail('NOT_FOUND', 'Årshjuls-posten hittades inte.');
  }
  if (current.tenant !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Åtkomst nekad — posten tillhör en annan tenant.');
  }

  const before = current[params.field] ?? null;
  if (before === normalized) {
    return ok({ itemId: params.itemId, field: params.field, before, after: normalized });
  }

  try {
    await pb.collection(PB_ID).update(params.itemId, { [params.field]: normalized });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'DB-uppdatering misslyckades.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: COLLECTION,
    record_id: params.itemId,
    field: params.field,
    before_value: before,
    after_value: normalized
  });

  return ok({ itemId: params.itemId, field: params.field, before, after: normalized });
}
