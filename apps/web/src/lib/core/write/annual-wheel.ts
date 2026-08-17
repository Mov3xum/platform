import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateAnnualWheelCategory,
  validateAnnualWheelDay,
  validateAnnualWheelMonth,
  validateAnnualWheelResponsible,
  validateAnnualWheelTags,
  validateNonEmptyText,
  validateOptionalText,
  validateYear
} from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

const COLLECTION = 'annual_wheel_items';
const PB_ID = PB_COLLECTIONS.annualWheelItems;

/** Roller som kan äga en årshjuls-aktivitet (samma krets som ser hjulet, § 21). */
const RESPONSIBLE_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

/**
 * Verifierar att en ansvarig faktiskt är en användare i actorns tenant med en
 * roll som ser årshjulet. Klienten skickar bara ett id — den är aldrig
 * säkerhetsgränsen (defense-in-depth, § 18.4-mönstret).
 */
async function assertResponsibleInTenant(
  pb: PocketBase,
  actor: Actor,
  userId: string
): Promise<WriteResult<string>> {
  let row: { id: string; tenant?: string; roles?: string[] };
  try {
    row = await pb
      .collection('users')
      .getOne<{ id: string; tenant?: string; roles?: string[] }>(userId, {
        fields: 'id,tenant,roles'
      });
  } catch {
    return fail('NOT_FOUND', 'Ansvarig användare hittades inte.');
  }
  if (String(row.tenant ?? '') !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Ansvarig tillhör en annan organisation.');
  }
  const roles = Array.isArray(row.roles) ? row.roles : [];
  if (!roles.some((r) => RESPONSIBLE_ROLES.includes(r))) {
    return fail('INVALID_VALUE', 'Ansvarig måste vara en resurs i Movexum-organisationen.');
  }
  return ok(row.id);
}

export interface CreateAnnualWheelItemParams {
  year: number;
  title: string;
  month?: number | null;
  day?: number | null;
  /** Valfria taggar (flera tillåtna). Ersätter tidigare obligatoriska `track`. */
  tags?: string[] | string | null;
  category: string;
  /** Valfri ansvarig (users-id) i organisationen. */
  responsible?: string | null;
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

  const tags = validateAnnualWheelTags(params.tags);
  if (!tags.ok) return fail('INVALID_VALUE', tags.error);

  const category = validateAnnualWheelCategory(params.category);
  if (!category.ok) return fail('INVALID_VALUE', category.error);

  const responsible = validateAnnualWheelResponsible(params.responsible);
  if (!responsible.ok) return fail('INVALID_VALUE', responsible.error);
  if (responsible.value) {
    const verified = await assertResponsibleInTenant(pb, actor, responsible.value);
    if (!verified.ok) return fail(verified.code ?? 'INVALID_VALUE', verified.error);
  }

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
    tags: tags.value,
    category: category.value,
    // Tom relation skrivs som '' (PB avvisar null på relation-fält).
    responsible: responsible.value ?? '',
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
      tags: tags.value,
      category: category.value,
      responsible: responsible.value
    }
  });

  return ok({ itemId: created.id, year: year.value, title: title.value });
}

export type AnnualWheelWritableField =
  | 'title'
  | 'month'
  | 'day'
  | 'tags'
  | 'category'
  | 'responsible'
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

/**
 * Jämför gammalt och nytt fältvärde. `tags` är en lista → ordnings-okänslig
 * jämförelse så att en oförändrad tagguppsättning inte skriver (och loggar) i
 * onödan. Tom relation kan komma tillbaka som '' eller null från PB.
 */
function sameValue(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? [...before].map(String).sort() : [];
    const b = Array.isArray(after) ? [...after].map(String).sort() : [];
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  const norm = (v: unknown) => (v === '' || v === null || v === undefined ? null : v);
  return norm(before) === norm(after);
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

  let normalized: string | number | string[] | null;
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
    case 'tags': {
      const r = validateAnnualWheelTags(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'responsible': {
      const r = validateAnnualWheelResponsible(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      if (r.value) {
        const verified = await assertResponsibleInTenant(pb, actor, r.value);
        if (!verified.ok) return fail(verified.code ?? 'INVALID_VALUE', verified.error);
      }
      normalized = r.value;
      break;
    }
    case 'category': {
      const r = validateAnnualWheelCategory(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
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
  if (sameValue(before, normalized)) {
    return ok({ itemId: params.itemId, field: params.field, before, after: normalized });
  }

  // Tom relation rensas med '' i PocketBase (null avvisas av relation-fältet).
  const payloadValue =
    params.field === 'responsible' && normalized === null ? '' : normalized;
  try {
    await pb.collection(PB_ID).update(params.itemId, { [params.field]: payloadValue });
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
