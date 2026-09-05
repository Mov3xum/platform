import 'server-only';
import type PocketBase from 'pocketbase';
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
import { listAnnualWheelCategoryKeys } from '@/lib/annual-wheel/categories';

/**
 * PB-target för BÅDE läsning och skrivning är kollektionens NAMN, inte dess
 * custom-id. En instans som provisionerats via `setup-via-api.mjs` (i stället
 * för migrationerna) kan ha fått ett annat, autogenererat collection-id — då
 * 404:ade skrivningar med "Missing or invalid collection context" medan
 * sidans läsningar (som alltid gått på namnet) fungerade. Namnet är stabilt i
 * båda vägarna.
 */
const COLLECTION = 'annual_wheel_items';

/** Roller som kan äga en årshjuls-aktivitet (samma krets som ser hjulet, § 21). */
const RESPONSIBLE_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

/** Fält som kräver migration 1700000138/1700000139 för att kunna lagras. */
const SCHEMA_FIELDS = ['day', 'tags', 'responsible'] as const;

interface PbFieldError {
  message?: string;
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : null;
}

/** Fältnycklar som PocketBase klagade på (t.ex. { track: 'Cannot be blank.' }). */
function pbFieldErrors(err: unknown): Record<string, string> {
  const data = (err as { response?: { data?: unknown }; data?: { data?: unknown } })?.response
    ?.data as Record<string, PbFieldError> | undefined;
  const nested = (err as { data?: { data?: unknown } })?.data?.data as
    | Record<string, PbFieldError>
    | undefined;
  const source = nested ?? data;
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [field, detail] of Object.entries(source)) {
    const message = detail && typeof detail === 'object' ? detail.message : undefined;
    if (typeof message === 'string') out[field] = message;
  }
  return out;
}

/**
 * PocketBase-fel som en LÄSBAR mening. SDK:ns `err.message` är alltid den
 * generiska "Failed to create record." — de användbara detaljerna ligger i
 * `response.data` per fält. Utan detta blev varje misslyckad skrivning en
 * odiagnostiserbar "Kunde inte skapa årshjuls-post".
 */
function describePbError(err: unknown, fallback: string): string {
  const fields = pbFieldErrors(err);
  const parts = Object.entries(fields).map(([field, message]) => `${field}: ${message}`);
  const base = err instanceof Error && err.message ? err.message : fallback;
  return parts.length > 0 ? `${base} (${parts.join('; ')})` : base;
}

/**
 * Kör en skrivning som den inloggade och faller tillbaka på en ev. medskickad
 * klient (superuser) vid 400/403 — PB v0.23.4:s rule-eval kan tyst neka en
 * behörig staff-användare (§ 21.3). Fallbacken skickas BARA av UI-actions som
 * redan verifierat rollen; agent-vägen får ingen (least privilege).
 */
async function runWrite<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>,
  options?: AnnualWheelWriteOptions
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if ((status === 400 || status === 403) && options?.fallbackPb) {
      const su = await options.fallbackPb();
      if (su) return await run(su);
    }
    throw err;
  }
}

export interface AnnualWheelWriteOptions {
  /**
   * Superuser-klient att falla tillbaka på vid rule-eval-nekande. Skickas bara
   * från server-actions (människa), aldrig från agentens verktyg.
   */
  fallbackPb?: () => Promise<PocketBase | null>;
}

/**
 * Vilka av de nyare fälten som SAKNAS i det faktiskt deployade schemat.
 * PocketBase släpper okända fält tyst vid create/update — utan den här
 * kontrollen sparas t.ex. ett datum "framgångsrikt" men försvinner (symtomet
 * "datumet syns inte i hjulet"). Samma mönster som /filer set-topic (§ 24.4).
 */
function missingSchemaFields(row: Record<string, unknown> | null): string[] {
  if (!row) return [];
  return SCHEMA_FIELDS.filter((f) => !(f in row));
}

/** Kollektionen finns inte alls i den deployade instansen. */
function collectionMissingMessage(): string {
  return (
    'Kollektionen `annual_wheel_items` finns inte i PocketBase-instansen — ' +
    'kör migrationerna (auto-migrate i PB-imagen) eller ' +
    '`node backend/pocketbase-schema/scripts/setup-via-api.mjs`. ' +
    'Diagnos: node backend/pocketbase-schema/scripts/diagnose-migrations.mjs'
  );
}

/** Läsbar instruktion när schemat släpar efter koden. */
export function schemaDriftMessage(fields: string[]): string {
  return (
    `Databasschemat saknar fälten ${fields.join(', ')} — kör migrationerna ` +
    '(1700000138 + 1700000139) eller `node backend/pocketbase-schema/scripts/' +
    'setup-via-api.mjs` mot instansen. Datum, ' +
    'taggar och ansvarig kan inte sparas förrän det är gjort.'
  );
}

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
  /** Fält som inte kunde lagras för att schemat släpar efter (PII-fritt). */
  schemaMissing?: string[];
}

/**
 * Skapar en årshjuls-post via det delade lagret (UI-action OCH agent-chatt går
 * härigenom). Tenant stämplas från actorn — aldrig från klienten — och varje
 * skrivning loggas i `agent_actions`. Ingen PII (intern verksamhetsplanering).
 */
export async function createAnnualWheelItem(
  pb: PocketBase,
  actor: Actor,
  params: CreateAnnualWheelItemParams,
  options?: AnnualWheelWriteOptions
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
    tags: tags.value,
    category: category.value,
    // Tom relation skrivs som '' (PB avvisar null på relation-fält).
    responsible: responsible.value ?? '',
    created_by: actor.id
  };
  if (notes.value) payload.notes = notes.value;

  let created: { id: string } & Record<string, unknown>;
  try {
    created = (await runWrite(pb, (c) => c.collection(COLLECTION).create(payload), options)) as {
      id: string;
    } & Record<string, unknown>;
  } catch (err) {
    // Instans där migration 1700000139 inte körts har kvar `track` som
    // OBLIGATORISKT fält. Appen skickar det inte längre → PB svarar 400
    // "track: Cannot be blank." Skriv då en gång till med spåret härlett ur
    // första taggen (annars 'ovrigt') så att aktiviteten faktiskt kan skapas.
    if (statusOf(err) === 404) return fail('NOT_FOUND', collectionMissingMessage());
    const legacyTrackRequired = 'track' in pbFieldErrors(err);
    if (!legacyTrackRequired) {
      return fail('DB_ERROR', describePbError(err, 'Kunde inte skapa årshjuls-post.'));
    }
    try {
      created = (await runWrite(
        pb,
        (c) => c.collection(COLLECTION).create({ ...payload, track: tags.value[0] ?? 'ovrigt' }),
        options
      )) as { id: string } & Record<string, unknown>;
    } catch (retryErr) {
      return fail('DB_ERROR', describePbError(retryErr, 'Kunde inte skapa årshjuls-post.'));
    }
  }

  // Läs tillbaka posten: PB släpper okända fält TYST, så en instans med gammalt
  // schema sparar aktiviteten men tappar datum/taggar/ansvarig. Rapportera det
  // i stället för att låtsas att allt gick bra.
  const schemaMissing = missingSchemaFields(created);

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

  return ok({
    itemId: created.id,
    year: year.value,
    title: title.value,
    ...(schemaMissing.length > 0 ? { schemaMissing } : {})
  });
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
  params: UpdateAnnualWheelItemFieldParams,
  options?: AnnualWheelWriteOptions
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
    // Hela posten (inte bara `fields`) → vi ser om kolumnen finns i schemat.
    current = (await pb.collection(COLLECTION).getOne(params.itemId)) as AnnualWheelRow;
  } catch (err) {
    const message = String((err as { message?: unknown })?.message ?? '');
    if (message.toLowerCase().includes('collection')) {
      return fail('NOT_FOUND', collectionMissingMessage());
    }
    return fail('NOT_FOUND', 'Årshjuls-posten hittades inte.');
  }
  if (current.tenant !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Åtkomst nekad — posten tillhör en annan tenant.');
  }
  // Saknas kolumnen i det deployade schemat skulle PB svara 200 men tyst
  // kasta värdet (t.ex. ett datum som "sparas" men aldrig syns).
  if (!(params.field in current)) {
    return fail('DB_ERROR', schemaDriftMessage([params.field]));
  }

  const before = current[params.field] ?? null;
  if (sameValue(before, normalized)) {
    return ok({ itemId: params.itemId, field: params.field, before, after: normalized });
  }

  // Tom relation rensas med '' i PocketBase (null avvisas av relation-fältet).
  const payloadValue =
    params.field === 'responsible' && normalized === null ? '' : normalized;
  try {
    await runWrite(
      pb,
      (c) => c.collection(COLLECTION).update(params.itemId, { [params.field]: payloadValue }),
      options
    );
  } catch (err) {
    return fail('DB_ERROR', describePbError(err, 'DB-uppdatering misslyckades.'));
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
