import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { escFilter } from '@/lib/pb-filter';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateBool,
  validateCompassChoices,
  validateCompassFlowType,
  validateCompassInputType,
  validateNonEmptyText,
  validateOptionalText,
  validateSlugKey
} from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';
import {
  COMPASS_LAYOUTS,
  MAX_COMPASS_MODULE_NAME,
  MAX_COMPASS_QUESTION_PROMPT,
  normalizeCompassLayout,
  planCompassQuestionInsert,
  sortCompassQuestions,
  slugifyCompassKey,
  type CompassFlowType,
  type CompassInputType
} from '@platform/shared';

/**
 * Delat skrivlager för Startupkompassens intag-moduler (CLAUDE.md § 23, § 31).
 *
 * Både människan (modul-admin) och agenten (staff-chatten, t.ex. röststyrd)
 * ska kunna skapa en modul och dess frågor — men bara EN uppsättning regler
 * får gälla. Därför går allt härigenom: rollpolicy (`writable-fields`),
 * validering (`validators`), tenant-stämpel från actorn (aldrig från
 * klienten/modellen) och audit i `agent_actions`.
 *
 * Vad agenten INTE får: publicera modulen (`is_active`) eller slå på den
 * publika URL:en (`public_url_enabled`). En modul som en AI skapat måste
 * granskas och publiceras av en människa i `/inflode/admin/modules`
 * (människa-i-loopen, EU AI Act art. 14).
 *
 * PII: modul- och frågekonfiguration innehåller ingen besökardata. Leads som
 * modulen sedan samlar in omfattas oförändrat av § 23.4 (samtycke,
 * dataminimering).
 */

const MODULES = 'compass_modules';
const QUESTIONS = 'compass_questions';

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

/**
 * Skriv via användarens token först; faller tillbaka på superuser vid
 * 400/403/404 (PB v0.23.4:s rule-eval-bugg, § 21.3 — samma mönster som
 * `lib/actions/compass.ts`). 404 ingår eftersom PocketBase svarar "not found"
 * — inte 403 — när update-/delete-regeln filtrerar bort posten för en i
 * själva verket behörig användare. Roll + tenant är ALLTID verifierade innan
 * detta anropas; superusern är en robusthetsfallback, inte behörighetsgränsen.
 */
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403 || status === 404) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

/** Läser en modul och verifierar att den tillhör actorns tenant. */
async function loadModuleInTenant(
  pb: PocketBase,
  actor: Actor,
  moduleId: string
): Promise<WriteResult<{ id: string; slug?: string; name?: string; flow_type?: string }>> {
  let row: { id: string; tenant?: string; slug?: string; name?: string; flow_type?: string };
  try {
    row = await pb.collection(MODULES).getOne(moduleId, {
      fields: 'id,tenant,slug,name,flow_type'
    });
  } catch {
    // Läsningen kan nekas av en trasig view-regel — försök som superuser och
    // gör tenant-kontrollen i koden (den är den faktiska gränsen här).
    const su = await getSuperuserPb();
    if (!su.ok) return fail('NOT_FOUND', 'Modulen hittades inte.');
    try {
      row = await su.pb.collection(MODULES).getOne(moduleId, {
        fields: 'id,tenant,slug,name,flow_type'
      });
    } catch {
      return fail('NOT_FOUND', 'Modulen hittades inte.');
    }
  }
  if (String(row.tenant ?? '') !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Modulen tillhör en annan organisation.');
  }
  return ok(row);
}

/**
 * Gör sluggen unik inom tenanten genom att lägga på ett suffix vid krock.
 * `public_slug` är dessutom GLOBALT unik (migration 1700000108) — den kan vi
 * inte läsa över tenant-gränsen, så där hanteras krocken av retry i
 * `createCompassModule`.
 */
async function uniqueTenantSlug(
  pb: PocketBase,
  tenant: string,
  base: string
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const existing = await pb.collection(MODULES).getList(1, 1, {
        filter: `tenant = "${escFilter(tenant)}" && slug = "${escFilter(candidate)}"`,
        fields: 'id'
      });
      if (existing.totalItems === 0) return candidate;
    } catch {
      // Kan vi inte läsa (regel-/schemafel) låter vi DB:ns unik-index avgöra.
      return candidate;
    }
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface CreateCompassModuleParams {
  name: string;
  flowType: string;
  description?: string;
  introMessage?: string;
  successMessage?: string;
  targetAudience?: string;
  consentNote?: string;
  /** Frivillig slug — härleds annars ur namnet. */
  slug?: string;
}

export interface CreatedCompassModuleResult {
  moduleId: string;
  slug: string;
  name: string;
  flowType: CompassFlowType;
  /** Relativ adminlänk så att chatten kan visa vart modulen tog vägen. */
  adminPath: string;
}

/**
 * Skapar en intag-modul i Startupkompassen. Modulen skapas ALLTID som
 * opublicerad (`is_active: false`, `public_url_enabled: false`) — även när en
 * människa kör den, eftersom en nyskapad modul saknar frågor. Publicering sker
 * i modul-admin.
 */
export async function createCompassModule(
  pb: PocketBase,
  actor: Actor,
  params: CreateCompassModuleParams
): Promise<WriteResult<CreatedCompassModuleResult>> {
  const policy = canCreateRecord(actor, MODULES);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const name = validateNonEmptyText(params.name, 'name', MAX_COMPASS_MODULE_NAME);
  if (!name.ok) return fail('INVALID_VALUE', name.error);

  const flowType = validateCompassFlowType(params.flowType);
  if (!flowType.ok) return fail('INVALID_VALUE', flowType.error);

  const description = validateOptionalText(params.description, 'description', 1000);
  if (!description.ok) return fail('INVALID_VALUE', description.error);

  const introMessage = validateOptionalText(params.introMessage, 'intro_message', 2000);
  if (!introMessage.ok) return fail('INVALID_VALUE', introMessage.error);

  const successMessage = validateOptionalText(params.successMessage, 'success_message', 2000);
  if (!successMessage.ok) return fail('INVALID_VALUE', successMessage.error);

  const targetAudience = validateOptionalText(params.targetAudience, 'target_audience', 500);
  if (!targetAudience.ok) return fail('INVALID_VALUE', targetAudience.error);

  const consentNote = validateOptionalText(params.consentNote, 'consent_note', 2000);
  if (!consentNote.ok) return fail('INVALID_VALUE', consentNote.error);

  const baseSlug = slugifyCompassKey(params.slug?.trim() || name.value);
  if (!baseSlug) {
    return fail('INVALID_VALUE', 'Modulnamnet måste innehålla bokstäver eller siffror.');
  }
  const slug = await uniqueTenantSlug(pb, actor.tenant, baseSlug);

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    slug,
    name: name.value,
    description: description.value,
    flow_type: flowType.value,
    intro_message: introMessage.value,
    success_message: successMessage.value,
    target_audience: targetAudience.value,
    consent_note: consentNote.value,
    // Opublicerad tills en människa granskat och publicerat (art. 14).
    is_active: false,
    public_url_enabled: false,
    // Slutförd körning skapar lead (steg 4-valet, migration 1700000125).
    create_lead: true,
    sort_order: 999
  };

  async function create(publicSlug: string) {
    return writeWithFallback(pb, (client) =>
      client.collection(MODULES).create({ ...payload, public_slug: publicSlug })
    );
  }

  let record: { id: string };
  try {
    try {
      record = await create(slug);
    } catch {
      // `public_slug` är globalt unik — krocka mot en annan tenant ⇒ suffix.
      record = await create(`${slug}-${Math.random().toString(36).slice(2, 6)}`);
    }
  } catch (err) {
    console.error('[write:compass] kunde inte skapa modul', {
      tenant: actor.tenant,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return fail('DB_ERROR', 'Kunde inte skapa modulen i Startupkompassen.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: MODULES,
    record_id: String(record.id),
    after_value: { slug, name: name.value, flow_type: flowType.value }
  });

  return ok({
    moduleId: String(record.id),
    slug,
    name: name.value,
    flowType: flowType.value,
    adminPath: `/inflode/admin/modules/${slug}`
  });
}

export interface AddCompassQuestionParams {
  moduleId: string;
  prompt: string;
  inputType?: string;
  key?: string;
  helpText?: string;
  required?: boolean | string;
  /** Endast för choice/multi_choice. Etiketter eller {label, value, score, buckets}. */
  choices?: unknown;
  /**
   * Frågans ABSOLUTA plats i modulen (1 = första frågan). Ger en
   * deterministisk ordning oavsett bearbetningsordning
   * (`planCompassQuestionInsert`). Saknas den läggs frågan sist.
   */
  position?: number;
  /** Explicit sorteringsordning (överstyr position); annars läggs frågan sist. */
  sortOrder?: number;
}

export interface AddedCompassQuestionResult {
  questionId: string;
  moduleId: string;
  key: string;
  inputType: CompassInputType;
  prompt: string;
  /** Det sort_order frågan faktiskt fick (kvitto/transparens). */
  sortOrder: number;
}

/**
 * Befintliga frågors `sort_order` i visningsordning (samma tiebreak som
 * läsvägen, `sortCompassQuestions`). Läser med användartoken; nekas
 * läsningen tyst (PB v0.23.4, § 21.3) försöker vi som superuser — tenant-
 * tillhörigheten är redan verifierad av anroparen.
 */
type QuestionOrderRow = { id: string; sort_order?: number; created?: string };

async function listQuestionOrder(pb: PocketBase, moduleId: string): Promise<QuestionOrderRow[]> {
  const read = (client: PocketBase) =>
    client.collection(QUESTIONS).getFullList<QuestionOrderRow>({
      filter: `module = "${escFilter(moduleId)}"`,
      sort: 'sort_order',
      fields: 'id,sort_order,created',
      batch: 200
    });
  try {
    return sortCompassQuestions(await read(pb));
  } catch {
    const su = await getSuperuserPb();
    if (!su.ok) throw new Error('Kunde inte läsa modulens frågor.');
    return sortCompassQuestions(await read(su.pb));
  }
}

/**
 * Nästa sorteringsnummer för en ny fråga som läggs SIST i modulen — delas av
 * modul-admin (`addQuestionAction`) och chatt-agenten så att BÅDA vägarna
 * numrerar på samma sätt. Tidigare använde UI:t `Date.now() % 1e6`, som efter
 * tusen sekunder börjar om från 0 → en fråga som lades till senare kunde hamna
 * FÖRE de befintliga. Kan läsningen inte göras alls faller vi tillbaka på en
 * monoton stämpel så frågorna ändå hamnar i skapandeordning.
 */
export async function nextCompassQuestionSortOrder(
  pb: PocketBase,
  moduleId: string
): Promise<number> {
  try {
    const rows = await listQuestionOrder(pb, moduleId);
    return planCompassQuestionInsert(rows.map((r) => r.sort_order)).sortOrder;
  } catch {
    return Date.now() % 1_000_000;
  }
}

/**
 * In-process-lås per modul: "läs högsta sort_order → skriv" måste vara
 * atomärt, annars får två samtidiga anrop samma nummer (grundorsaken till
 * "6, 1, 9"). Agentloopen kör redan skrivanrop sekventiellt (§ 16.2); låset
 * täcker övriga vägar (två flikar, två turer, modul-admin + chatt).
 */
const moduleLocks = new Map<string, Promise<unknown>>();

async function withModuleLock<T>(moduleId: string, fn: () => Promise<T>): Promise<T> {
  const previous = moduleLocks.get(moduleId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  moduleLocks.set(moduleId, next);
  try {
    return await next;
  } finally {
    if (moduleLocks.get(moduleId) === next) moduleLocks.delete(moduleId);
  }
}

/**
 * `compass_questions` har ett UNIKT index på (module, key). Nyckeln härleds ur
 * frågetexten, så två snarlika frågor kan krocka — då lägger vi på ett suffix
 * i stället för att låta DB:n kasta ett obegripligt fel mot användaren.
 */
async function uniqueQuestionKey(
  pb: PocketBase,
  moduleId: string,
  base: string
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 100);
    try {
      const existing = await pb.collection(QUESTIONS).getList(1, 1, {
        filter: `module = "${escFilter(moduleId)}" && key = "${escFilter(candidate)}"`,
        fields: 'id'
      });
      if (existing.totalItems === 0) return candidate;
    } catch {
      // Kan vi inte läsa låter vi unik-indexet avgöra.
      return candidate;
    }
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 100);
}

/**
 * Lägger till en fråga i en intag-modul. Nyckeln (`key`) härleds ur frågetexten
 * om ingen anges — den som talar in en modul ska aldrig behöva formulera en
 * teknisk nyckel.
 */
export async function addCompassQuestion(
  pb: PocketBase,
  actor: Actor,
  params: AddCompassQuestionParams
): Promise<WriteResult<AddedCompassQuestionResult>> {
  const policy = canCreateRecord(actor, QUESTIONS);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const moduleId = String(params.moduleId ?? '').trim();
  if (!moduleId) return fail('INVALID_VALUE', 'moduleId saknas.');

  const mod = await loadModuleInTenant(pb, actor, moduleId);
  if (!mod.ok) return fail(mod.code ?? 'NOT_FOUND', mod.error);

  const prompt = validateNonEmptyText(params.prompt, 'prompt', MAX_COMPASS_QUESTION_PROMPT);
  if (!prompt.ok) return fail('INVALID_VALUE', prompt.error);

  const inputType = validateCompassInputType(params.inputType ?? 'short_text');
  if (!inputType.ok) return fail('INVALID_VALUE', inputType.error);

  const keyResult = validateSlugKey(params.key?.trim() || prompt.value, 'key', 100);
  if (!keyResult.ok) return fail('INVALID_VALUE', keyResult.error);
  const key = await uniqueQuestionKey(pb, moduleId, keyResult.value);

  const helpText = validateOptionalText(params.helpText, 'help_text', 1000);
  if (!helpText.ok) return fail('INVALID_VALUE', helpText.error);

  const required = validateBool(params.required, false);
  if (!required.ok) return fail('INVALID_VALUE', required.error);

  const choices = validateCompassChoices(params.choices, inputType.value);
  if (!choices.ok) return fail('INVALID_VALUE', choices.error);

  const positionRaw = Number(params.position);
  const position =
    params.position !== undefined && Number.isFinite(positionRaw) && positionRaw >= 1
      ? Math.floor(positionRaw)
      : undefined;

  // Läs-högsta + skriv sker under modul-låset så att numreringen aldrig kan
  // krocka mellan två samtidiga anrop.
  let record: { id: string };
  let sortOrder: number;
  try {
    ({ record, sortOrder } = await withModuleLock(moduleId, async () => {
      let order: number;
      if (typeof params.sortOrder === 'number' && Number.isFinite(params.sortOrder)) {
        order = params.sortOrder;
      } else if (position === undefined) {
        order = await nextCompassQuestionSortOrder(pb, moduleId);
      } else {
        // Absolut plats (1 = första frågan i modulen): skjut in mellan
        // grannarna; är gapet slut numreras de befintliga om FÖRST, så att
        // ordningen är korrekt även när anropen bearbetas i annan ordning
        // än positionerna ("6, 1, 9").
        const rows = await listQuestionOrder(pb, moduleId);
        const plan = planCompassQuestionInsert(
          rows.map((r) => r.sort_order),
          position
        );
        if (plan.renumber) {
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const target = plan.renumber[i]!;
            if (row.sort_order === target) continue;
            await writeWithFallback(pb, (client) =>
              client.collection(QUESTIONS).update(row.id, { sort_order: target })
            );
          }
        }
        order = plan.sortOrder;
      }

      const payload: Record<string, unknown> = {
        module: moduleId,
        key,
        prompt: prompt.value,
        input_type: inputType.value,
        required: required.value,
        sort_order: order
      };
      if (helpText.value) payload.help_text = helpText.value;
      if (choices.value) payload.choices = choices.value;

      const created = await writeWithFallback(pb, (client) =>
        client.collection(QUESTIONS).create(payload)
      );
      return { record: created as { id: string }, sortOrder: order };
    }));
  } catch (err) {
    console.error('[write:compass] kunde inte skapa fråga', {
      tenant: actor.tenant,
      moduleId,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return fail('DB_ERROR', 'Kunde inte lägga till frågan i modulen.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: QUESTIONS,
    record_id: String(record.id),
    after_value: { module: moduleId, key, input_type: inputType.value, sort_order: sortOrder }
  });

  return ok({
    questionId: String(record.id),
    moduleId,
    key,
    inputType: inputType.value,
    prompt: prompt.value,
    sortOrder
  });
}

export type CompassModuleWritableField =
  | 'name'
  | 'description'
  | 'intro_message'
  | 'success_message'
  | 'target_audience'
  | 'consent_note'
  | 'flow_type'
  | 'layout'
  | 'is_active'
  | 'public_url_enabled';

export interface UpdateCompassModuleFieldParams {
  moduleId: string;
  field: CompassModuleWritableField;
  value: unknown;
}

export interface UpdatedCompassModuleResult {
  moduleId: string;
  field: string;
  before: unknown;
  after: unknown;
}

/** Uppdaterar ETT whitelistat fält på en modul (samma mönster som § 30). */
export async function updateCompassModuleField(
  pb: PocketBase,
  actor: Actor,
  params: UpdateCompassModuleFieldParams
): Promise<WriteResult<UpdatedCompassModuleResult>> {
  const policy = canWriteField(actor, MODULES, params.field);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skrivning nekad.'
    );
  }

  const moduleId = String(params.moduleId ?? '').trim();
  if (!moduleId) return fail('INVALID_VALUE', 'moduleId saknas.');

  let existing: Record<string, unknown>;
  try {
    existing = await pb.collection(MODULES).getOne(moduleId);
  } catch {
    const su = await getSuperuserPb();
    if (!su.ok) return fail('NOT_FOUND', 'Modulen hittades inte.');
    try {
      existing = await su.pb.collection(MODULES).getOne(moduleId);
    } catch {
      return fail('NOT_FOUND', 'Modulen hittades inte.');
    }
  }
  if (String(existing.tenant ?? '') !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Modulen tillhör en annan organisation.');
  }

  let value: unknown;
  switch (params.field) {
    case 'name': {
      const r = validateNonEmptyText(params.value, 'name', MAX_COMPASS_MODULE_NAME);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      value = r.value;
      break;
    }
    case 'flow_type': {
      const r = validateCompassFlowType(params.value);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      value = r.value;
      break;
    }
    case 'is_active':
    case 'public_url_enabled': {
      const r = validateBool(params.value, false);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      value = r.value;
      break;
    }
    case 'layout': {
      // Strikt: ett värde som inte kan tolkas till en mall avvisas med de
      // giltiga namnen — aldrig ett tyst "classic" när modellen gissat fel.
      const raw = typeof params.value === 'string' ? params.value.trim() : '';
      const normalized = normalizeCompassLayout(raw);
      if (!raw || (normalized === 'classic' && !/^(classic|klassisk|standard|default)$/i.test(raw))) {
        return fail(
          'INVALID_VALUE',
          `Okänd mall "${raw}". Giltiga mallar: ${COMPASS_LAYOUTS.join(', ')}.`
        );
      }
      value = normalized;
      break;
    }
    default: {
      const r = validateOptionalText(params.value, params.field, 2000);
      if (!r.ok) return fail('INVALID_VALUE', r.error);
      value = r.value;
      break;
    }
  }

  const before = existing[params.field] ?? null;
  try {
    await writeWithFallback(pb, (client) =>
      client.collection(MODULES).update(moduleId, { [params.field]: value })
    );
  } catch (err) {
    console.error('[write:compass] kunde inte uppdatera modul', {
      tenant: actor.tenant,
      moduleId,
      field: params.field,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return fail('DB_ERROR', 'Kunde inte uppdatera modulen.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: MODULES,
    record_id: moduleId,
    field: params.field,
    before_value: before,
    after_value: value
  });

  return ok({ moduleId, field: params.field, before, after: value });
}
