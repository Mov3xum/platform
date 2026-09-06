import 'server-only';
import type PocketBase from 'pocketbase';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateAnnualWheelCategory,
  validateAnnualWheelDay,
  validateAnnualWheelEndDay,
  validateAnnualWheelEndMonth,
  validateAnnualWheelMonth,
  validateAnnualWheelResponsible,
  validateAnnualWheelTags,
  validateNonEmptyText,
  validateOptionalText,
  validateYear
} from './validators';
import {
  expandAnnualWheelSeries,
  isAnnualWheelRepeat
} from '@platform/shared';
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

/** Fält som kräver migration 1700000138/1700000139/1700000141 för att lagras. */
const SCHEMA_FIELDS = ['day', 'tags', 'responsible', 'end_month', 'end_day'] as const;

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
  const raw = err instanceof Error && err.message ? err.message : '';
  // SDK:ns generiska engelska meddelanden ersätts med fallback-texten; PB:s
  // fältdetaljer (det som faktiskt förklarar felet) behålls.
  const generic = /^Failed to (create|update|delete) record\.?$/i.test(raw) || !raw;
  const base = generic ? fallback : raw;
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

/**
 * Normaliserar och kontrollerar en periods start/slut. En period måste sluta
 * EFTER att den börjat och ligga inom samma kalenderår (årshjulet visar ett år
 * i taget). Slut utan start är meningslöst → nollställs i stället för att fela.
 */
function normalizePeriod(
  month: number | null,
  day: number | null,
  endMonth: number | null,
  endDay: number | null
): { ok: true; value: { endMonth: number | null; endDay: number | null } } | { ok: false; error: string } {
  if (month === null || endMonth === null) return { ok: true, value: { endMonth: null, endDay: null } };
  if (endMonth < month) {
    return {
      ok: false,
      error: 'Periodens slut måste ligga efter starten (samma kalenderår).'
    };
  }
  if (endMonth === month && endDay !== null && day !== null && endDay <= day) {
    return { ok: false, error: 'Periodens slutdag måste ligga efter startdagen.' };
  }
  return { ok: true, value: { endMonth, endDay } };
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
  /** Slutmånad för en PERIOD (kampanj). Tomt = punktaktivitet. */
  end_month?: number | null;
  /** Slutdag inom slutmånaden (tomt = månadens sista dag). */
  end_day?: number | null;
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

  const endMonth = validateAnnualWheelEndMonth(params.end_month);
  if (!endMonth.ok) return fail('INVALID_VALUE', endMonth.error);

  const endDay = validateAnnualWheelEndDay(params.end_day);
  if (!endDay.ok) return fail('INVALID_VALUE', endDay.error);

  const period = normalizePeriod(month.value, day.value, endMonth.value, endDay.value);
  if (!period.ok) return fail('INVALID_VALUE', period.error);

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
    end_month: period.value.endMonth,
    end_day: period.value.endDay,
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
      return fail('DB_ERROR', describePbError(err, 'Kunde inte spara aktiviteten.'));
    }
    try {
      created = (await runWrite(
        pb,
        (c) => c.collection(COLLECTION).create({ ...payload, track: tags.value[0] ?? 'ovrigt' }),
        options
      )) as { id: string } & Record<string, unknown>;
    } catch (retryErr) {
      return fail('DB_ERROR', describePbError(retryErr, 'Kunde inte spara aktiviteten.'));
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
      end_month: period.value.endMonth,
      end_day: period.value.endDay,
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

// ─── Serier (upprepade aktiviteter) ──────────────────────────────────────────

export interface CreateAnnualWheelSeriesParams extends CreateAnnualWheelItemParams {
  /** 'none' | 'monthly' | 'bimonthly' | 'quarterly'. */
  repeat?: string;
  /** Sista månad serien får sträcka sig till (1–12, default december). */
  repeat_until_month?: number | null;
}

export interface CreatedAnnualWheelSeriesResult {
  itemIds: string[];
  created: number;
  /** Månaderna som faktiskt skapades (för ett tydligt svar till användaren). */
  months: number[];
  schemaMissing?: string[];
}

/**
 * Skapar EN aktivitet eller en hel SERIE ("nyhetsbrev den 15:e varje månad").
 * Expansionen är den rena, enhetstestade `expandAnnualWheelSeries` i
 * @platform/shared, och varje förekomst går genom `createAnnualWheelItem` —
 * alltså exakt samma whitelist, validering, tenant-stämpel och audit-logg som
 * en enskild aktivitet. UI-actionen OCH chatt-agenten använder den här
 * funktionen, så serier kan aldrig divergera mellan människa och agent (§ 16).
 *
 * Delvis lyckad serie rapporteras som fel MED de skapade id:na, så anroparen
 * kan säga vad som faktiskt hände i stället för att låtsas att allt gick bra.
 */
export async function createAnnualWheelSeries(
  pb: PocketBase,
  actor: Actor,
  params: CreateAnnualWheelSeriesParams,
  options?: AnnualWheelWriteOptions
): Promise<WriteResult<CreatedAnnualWheelSeriesResult>> {
  const repeat = isAnnualWheelRepeat(params.repeat) ? params.repeat : 'none';
  const year = validateYear(params.year);
  if (!year.ok) return fail('INVALID_VALUE', year.error);

  const occurrences = expandAnnualWheelSeries(
    {
      year: year.value,
      month: params.month ?? null,
      day: params.day ?? null,
      end_month: params.end_month ?? null,
      end_day: params.end_day ?? null
    },
    repeat,
    params.repeat_until_month ?? 12
  );

  // Odaterad aktivitet (helår) kan inte upprepas — skapa den en gång.
  if (occurrences.length === 0) {
    const single = await createAnnualWheelItem(pb, actor, params, options);
    if (!single.ok) return fail(single.code ?? 'DB_ERROR', single.error);
    return ok({
      itemIds: [single.value.itemId],
      created: 1,
      months: [],
      ...(single.value.schemaMissing ? { schemaMissing: single.value.schemaMissing } : {})
    });
  }

  const itemIds: string[] = [];
  const months: number[] = [];
  let schemaMissing: string[] | undefined;

  for (const occurrence of occurrences) {
    const result = await createAnnualWheelItem(
      pb,
      actor,
      {
        ...params,
        month: occurrence.month,
        day: occurrence.day,
        end_month: occurrence.end_month,
        end_day: occurrence.end_day
      },
      options
    );
    if (!result.ok) {
      // Avbryt vid första felet men behåll det som redan skapats (idempotens
      // finns inte på den här kollektionen — bättre att vara ärlig än att
      // försöka rulla tillbaka halvvägs).
      const created = itemIds.length;
      return fail(
        result.code ?? 'DB_ERROR',
        created > 0
          ? `${created} av ${occurrences.length} aktiviteter skapades innan det sprack: ${result.error}`
          : result.error
      );
    }
    itemIds.push(result.value.itemId);
    months.push(occurrence.month);
    if (result.value.schemaMissing) schemaMissing = result.value.schemaMissing;
  }

  return ok({
    itemIds,
    created: itemIds.length,
    months,
    ...(schemaMissing ? { schemaMissing } : {})
  });
}

export type AnnualWheelWritableField =
  | 'title'
  | 'month'
  | 'day'
  | 'end_month'
  | 'end_day'
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
  month?: unknown;
  day?: unknown;
  end_month?: unknown;
  end_day?: unknown;
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
    case 'end_month': {
      const r = validateAnnualWheelEndMonth(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      normalized = r.value;
      break;
    }
    case 'end_day': {
      const r = validateAnnualWheelEndDay(params.value);
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

  // Perioden måste hänga ihop även när BARA en ände ändras — kontrollera det
  // nya värdet mot postens övriga datumfält.
  if (['month', 'day', 'end_month', 'end_day'].includes(params.field)) {
    const asNumber = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    const next = {
      month: params.field === 'month' ? (normalized as number | null) : asNumber(current.month),
      day: params.field === 'day' ? (normalized as number | null) : asNumber(current.day),
      end_month:
        params.field === 'end_month' ? (normalized as number | null) : asNumber(current.end_month),
      end_day: params.field === 'end_day' ? (normalized as number | null) : asNumber(current.end_day)
    };
    const period = normalizePeriod(next.month, next.day, next.end_month, next.end_day);
    if (!period.ok) return fail('INVALID_VALUE', period.error);
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
    return fail('DB_ERROR', describePbError(err, 'Kunde inte spara ändringen.'));
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
