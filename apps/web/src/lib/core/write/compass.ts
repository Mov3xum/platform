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
  MAX_COMPASS_MODULE_NAME,
  MAX_COMPASS_QUESTION_PROMPT,
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
 * Skriv via användarens token först; faller tillbaka på superuser vid 400/403
 * (PB v0.23.4:s rule-eval-bugg, § 21.3 — samma mönster som
 * `lib/actions/compass.ts`). Roll + tenant är ALLTID verifierade innan detta
 * anropas; superusern är en robusthetsfallback, inte behörighetsgränsen.
 */
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
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
  /** Sorteringsordning; annars läggs frågan sist. */
  sortOrder?: number;
}

export interface AddedCompassQuestionResult {
  questionId: string;
  moduleId: string;
  key: string;
  inputType: CompassInputType;
  prompt: string;
}

/** Nästa lediga sorteringsnummer i modulen (frågan hamnar sist). */
async function nextSortOrder(pb: PocketBase, moduleId: string): Promise<number> {
  try {
    const list = await pb.collection(QUESTIONS).getList<{ sort_order?: number }>(1, 1, {
      filter: `module = "${escFilter(moduleId)}"`,
      sort: '-sort_order',
      fields: 'sort_order'
    });
    const highest = Number(list.items[0]?.sort_order ?? 0);
    return Number.isFinite(highest) ? highest + 10 : 10;
  } catch {
    // Kan vi inte läsa ordningen (regel-/schemafel) faller vi tillbaka på en
    // monoton stämpel — samma trick som `addQuestionAction` — så att frågorna
    // ändå hamnar i den ordning de skapades.
    return Date.now() % 1_000_000;
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

  const sortOrder =
    typeof params.sortOrder === 'number' && Number.isFinite(params.sortOrder)
      ? params.sortOrder
      : await nextSortOrder(pb, moduleId);

  const payload: Record<string, unknown> = {
    module: moduleId,
    key,
    prompt: prompt.value,
    input_type: inputType.value,
    required: required.value,
    sort_order: sortOrder
  };
  if (helpText.value) payload.help_text = helpText.value;
  if (choices.value) payload.choices = choices.value;

  let record: { id: string };
  try {
    record = await writeWithFallback(pb, (client) =>
      client.collection(QUESTIONS).create(payload)
    );
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
    after_value: { module: moduleId, key, input_type: inputType.value }
  });

  return ok({
    questionId: String(record.id),
    moduleId,
    key,
    inputType: inputType.value,
    prompt: prompt.value
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
