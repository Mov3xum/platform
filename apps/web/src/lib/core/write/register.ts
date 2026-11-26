import 'server-only';
import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_RECORD_TYPES,
  buildArchiveInventory,
  canManageRegister,
  canRegisterManually,
  cleanRegisterText,
  formatCaseNumber,
  formatEntryDesignation,
  normalizeArchiveDescription,
  registerEntryHashPayload,
  stockholmDateKey,
  validateDisclosureInput,
  validateManualEntryInput,
  validateRecordTypeInput,
  type ArchiveDescription,
  type DisclosureInput,
  type ManualEntryInput,
  type RecordDirection,
  type RecordRetention,
  type RecordTypeInput,
  type RecordTypePlan,
  type RegisterVia
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { withDistributedLock } from '@/lib/distributed-lock';
import { logAgentAction } from './audit';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Diarium, informationshanteringsplan och arkivförteckning (CLAUDE.md § 60) —
 * det delade skrivlagret.
 *
 * ALLA skrivningar går via den cachade superusern: kollektionernas skrivregler
 * är null, så ingen användartoken kan skapa, ändra eller ta bort en diariepost.
 * Rollen prövas HÄR innan superusern används. Automatiska registreringar
 * (`registerRecord`) anropas av de flöden där handlingen blir allmän, efter att
 * flödet självt verifierat behörigheten — de kastar aldrig och fäller aldrig
 * huvudmutationen (`registerRecordSafe`); det som missas fångas av
 * granskningsvyns täckningskontroll och "Efterregistrera saknade".
 *
 * Audit: manuella åtgärder (registrering, sekretess, makulering, utlämnande,
 * plan, förteckning) loggas PII-fritt i `agent_actions`. Automatiska
 * registreringar loggas inte där — diarieposten ÄR spåret.
 */

export const REGISTER_MIGRATION_HINT =
  'Diariet saknas i databasen — kör migration 1700000219 (eller workflowen "Sync PocketBase").';
const NO_SUPERUSER =
  'Servern kan inte skriva i diariet: POCKETBASE_SUPERUSER_EMAIL/PASSWORD saknas på web-appen.';

export const RECORD_TYPES = 'record_types';
export const REGISTER_CASES = 'register_cases';
export const REGISTER_ENTRIES = 'register_entries';
export const REGISTER_DISCLOSURES = 'register_disclosures';
export const ARCHIVE_PROFILES = 'archive_profiles';
export const ARCHIVE_VERSIONS = 'archive_versions';

export interface RecordTypeRow extends RecordTypePlan {
  id: string;
  active: boolean;
  confirmed: boolean;
  confirmed_at: string;
  updated: string;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function isUniqueViolation(err: unknown): boolean {
  if (statusOf(err) !== 400) return false;
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data ?? {};
  return Object.values(data).some((v) => v?.code === 'validation_not_unique');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

async function superuser(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  return su.ok ? su.pb : null;
}

function toTypeRow(r: Record<string, unknown>): RecordTypeRow {
  return {
    id: String(r.id),
    key: String(r.key ?? ''),
    label: String(r.label ?? ''),
    process: String(r.process ?? ''),
    direction: (r.direction as RecordDirection) ?? 'created',
    trigger: String(r.trigger ?? ''),
    handling: (r.handling as RecordTypePlan['handling']) ?? 'register',
    secrecy_possible: r.secrecy_possible === true,
    secrecy_basis: String(r.secrecy_basis ?? ''),
    retention: (r.retention as RecordRetention) ?? 'preserve',
    retention_months: typeof r.retention_months === 'number' && r.retention_months > 0 ? r.retention_months : null,
    legal_basis: String(r.legal_basis ?? ''),
    storage: String(r.storage ?? ''),
    source_collection: String(r.source_collection ?? ''),
    sort_order: typeof r.sort_order === 'number' ? r.sort_order : 0,
    active: r.active !== false,
    confirmed: r.confirmed === true,
    confirmed_at: String(r.confirmed_at ?? ''),
    updated: String(r.updated ?? '')
  };
}

/**
 * Läser tenantens plan med valfri klient. Kastar vid läsfel — ett fel får
 * aldrig tolkas som "tom plan" (då skulle standardraderna seedas om).
 */
export async function readRecordTypes(client: PocketBase, tenant: string): Promise<RecordTypeRow[]> {
  const rows = await client.collection(RECORD_TYPES).getFullList<Record<string, unknown>>({
    filter: client.filter('tenant = {:t}', { t: tenant }),
    batch: 200
  });
  return rows.map(toTypeRow).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'sv'));
}

/**
 * Planen för tenanten; materialiserar Movexums förslag första gången (bara
 * efter en LYCKAD tom läsning) och lägger till standardrader som tillkommit i
 * koden. Befintliga rader rörs aldrig.
 */
export async function ensureRecordPlan(su: PocketBase, tenant: string): Promise<RecordTypeRow[]> {
  const existing = await readRecordTypes(su, tenant);
  const have = new Set(existing.map((t) => t.key));
  const missing = DEFAULT_RECORD_TYPES.filter((t) => !have.has(t.key));
  if (missing.length === 0) return existing;
  for (const t of missing) {
    try {
      await su.collection(RECORD_TYPES).create({ ...t, tenant, active: true, confirmed: false });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return readRecordTypes(su, tenant);
}

// ─── Registrering ─────────────────────────────────────────────────────────

export interface RegisterInput {
  tenant: string;
  actorId?: string | null;
  typeKey: string;
  source?: { collection: string; id: string; event: string } | null;
  /** Registrera i ett befintligt ärende (manuell väg). */
  caseId?: string | null;
  title: string;
  caseTitle?: string;
  counterpart?: string;
  startupId?: string | null;
  /** Handlingens eget datum (inkom/upprättades). Default: nu. */
  documentDate?: string | null;
  documentHash?: string | null;
  /** PII-fria fakta om handlingen (id:n, belopp, status) — ingår i kontrollsumman. */
  snapshot?: Record<string, unknown>;
  secrecy?: boolean;
  secrecyBasis?: string;
  note?: string;
  via: RegisterVia;
  closeCase?: boolean;
}

export type RegisterOutcome =
  | { status: 'registered' | 'exists'; entryId: string; caseId: string; designation: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string };

async function findEntryBySource(su: PocketBase, input: RegisterInput): Promise<RegisterOutcome | null> {
  if (!input.source) return null;
  try {
    const hit = await su.collection(REGISTER_ENTRIES).getFirstListItem<{ id: string; register_case: string; designation: string }>(
      su.filter('tenant = {:t} && source_collection = {:c} && source_id = {:i} && source_event = {:e}', {
        t: input.tenant,
        c: input.source.collection,
        i: input.source.id,
        e: input.source.event
      }),
      { fields: 'id,register_case,designation' }
    );
    return { status: 'exists', entryId: hit.id, caseId: hit.register_case, designation: hit.designation };
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

async function maxSeq(su: PocketBase, collection: string, filter: string): Promise<number> {
  const res = await su.collection(collection).getList<{ seq: number }>(1, 1, { filter, sort: '-seq', fields: 'seq' });
  return res.items[0]?.seq ?? 0;
}

interface CaseRow {
  id: string;
  tenant: string;
  number: string;
  status: string;
}

async function resolveCase(su: PocketBase, input: RegisterInput, type: RecordTypeRow, at: Date): Promise<CaseRow> {
  if (input.caseId) {
    const row = await su.collection(REGISTER_CASES).getOne<CaseRow>(input.caseId, { fields: 'id,tenant,number,status' });
    if (row.tenant !== input.tenant) throw Object.assign(new Error('tenant'), { status: 404 });
    return row;
  }
  if (input.source) {
    try {
      return await su.collection(REGISTER_CASES).getFirstListItem<CaseRow>(
        su.filter('tenant = {:t} && source_collection = {:c} && source_id = {:i}', { t: input.tenant, c: input.source.collection, i: input.source.id }),
        { fields: 'id,tenant,number,status' }
      );
    } catch (err) {
      if (statusOf(err) !== 404) throw err;
    }
  }
  const year = Number(stockholmDateKey(at).slice(0, 4));
  const seq = (await maxSeq(su, REGISTER_CASES, su.filter('tenant = {:t} && year = {:y}', { t: input.tenant, y: year }))) + 1;
  const number = formatCaseNumber(year, seq);
  const created = await su.collection(REGISTER_CASES).create<{ id: string }>({
    tenant: input.tenant,
    year,
    seq,
    number,
    title: cleanRegisterText(input.caseTitle || input.title, 200),
    type_key: type.key,
    process: type.process,
    counterpart: cleanRegisterText(input.counterpart, 160),
    source_collection: input.source?.collection ?? '',
    source_id: input.source?.id ?? '',
    startup: input.startupId || null,
    status: 'open',
    opened_at: at.toISOString(),
    created_by: input.actorId || null
  });
  return { id: created.id, tenant: input.tenant, number, status: 'open' };
}

/**
 * Registrerar en handling i diariet. Idempotent per (källa, post, händelse):
 * ett omförsök ger samma post tillbaka. Körs under ett lås per tenant så att
 * löpnumren delas ut i en obruten serie; de unika indexen är den hårda gränsen.
 */
export async function registerRecord(input: RegisterInput): Promise<RegisterOutcome> {
  const su = await superuser();
  if (!su) return { status: 'error', reason: NO_SUPERUSER };
  try {
    const types = await ensureRecordPlan(su, input.tenant);
    const type = types.find((t) => t.key === input.typeKey);
    if (!type) return { status: 'skipped', reason: `Handlingstypen ${input.typeKey} finns inte i planen.` };
    if (!type.active) return { status: 'skipped', reason: 'Handlingstypen är avstängd i planen.' };
    if (type.handling !== 'register') return { status: 'skipped', reason: 'Handlingstypen registreras inte enligt planen.' };

    const early = await findEntryBySource(su, input);
    if (early) return early;

    const run = async (): Promise<RegisterOutcome> => {
      const again = await findEntryBySource(su, input);
      if (again) return again;
      const at = new Date();
      const caseRow = await resolveCase(su, input, type, at);
      const seq = (await maxSeq(su, REGISTER_ENTRIES, su.filter('tenant = {:t} && register_case = {:c}', { t: input.tenant, c: caseRow.id }))) + 1;
      const designation = formatEntryDesignation(caseRow.number, seq);
      const title = cleanRegisterText(input.title, 200);
      const documentDate = input.documentDate && !Number.isNaN(Date.parse(input.documentDate)) ? new Date(input.documentDate).toISOString() : at.toISOString();
      const documentHash = (input.documentHash || '').slice(0, 80);
      const snapshot = input.snapshot ?? {};
      const contentHash = sha256(
        registerEntryHashPayload({
          type_key: type.key,
          title,
          direction: type.direction,
          document_date: documentDate,
          source_collection: input.source?.collection ?? '',
          source_id: input.source?.id ?? '',
          source_event: input.source?.event ?? '',
          document_hash: documentHash,
          snapshot
        })
      );
      const secrecy = input.secrecy ?? type.secrecy_possible;
      const entry = await su.collection(REGISTER_ENTRIES).create<{ id: string }>({
        tenant: input.tenant,
        register_case: caseRow.id,
        seq,
        designation,
        type_key: type.key,
        type_label: type.label,
        direction: type.direction,
        title,
        counterpart: cleanRegisterText(input.counterpart, 160),
        document_date: documentDate,
        registered_at: at.toISOString(),
        source_collection: input.source?.collection ?? '',
        source_id: input.source?.id ?? '',
        source_event: input.source?.event ?? '',
        document_hash: documentHash,
        content_hash: contentHash,
        snapshot,
        secrecy,
        secrecy_basis: secrecy ? cleanRegisterText(input.secrecyBasis || type.secrecy_basis, 300) : '',
        retention: type.retention,
        retention_months: type.retention_months ?? 0,
        via: input.via,
        registered_by: input.actorId || null,
        note: cleanRegisterText(input.note, 500)
      });
      if (input.closeCase && caseRow.status !== 'closed') {
        await su
          .collection(REGISTER_CASES)
          .update(caseRow.id, { status: 'closed', closed_at: at.toISOString(), closed_by: input.actorId || null })
          .catch(() => undefined);
      }
      return { status: 'registered', entryId: entry.id, caseId: caseRow.id, designation };
    };

    const locked = () => withDistributedLock(`register:${input.tenant}`, run, { ttlMs: 15_000, waitMs: 10_000 });
    try {
      return await locked();
    } catch (err) {
      // En parallell container hann före (unikt index) — läs om och försök en gång till.
      if (isUniqueViolation(err)) return await locked();
      throw err;
    }
  } catch (err) {
    const status = statusOf(err);
    console.error('[register] registration failed', { status, type: input.typeKey, source: input.source?.collection, via: input.via });
    return { status: 'error', reason: status === 404 ? REGISTER_MIGRATION_HINT : 'Handlingen kunde inte registreras i diariet.' };
  }
}

/** Automatisk registrering från ett flöde: kastar aldrig, fäller aldrig huvudmutationen. */
export async function registerRecordSafe(input: RegisterInput): Promise<void> {
  try {
    await registerRecord(input);
  } catch (err) {
    console.error('[register] unexpected', { type: input.typeKey, status: statusOf(err) });
  }
}

// ─── Manuella åtgärder ────────────────────────────────────────────────────

function requireManager(actor: Actor): WriteResult<never> | null {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Diariet förvaltas av en människa.');
  if (!canManageRegister(actor.roles)) return fail('FORBIDDEN', 'Bara admin och inkubatorledning förvaltar diariet.');
  return null;
}

async function loadInTenant<T extends { id: string; tenant: string }>(su: PocketBase, collection: string, id: string, tenant: string): Promise<T | null> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) return null;
  try {
    const row = await su.collection(collection).getOne<T>(id);
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

export async function registerManualEntry(
  actor: Actor,
  input: ManualEntryInput & { case_id?: string | null; close_case?: boolean }
): Promise<WriteResult<{ entryId: string; caseId: string; designation: string }>> {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Handlingar registreras av en människa.');
  if (!canRegisterManually(actor.roles)) return fail('FORBIDDEN', 'Du saknar behörighet att registrera handlingar.');
  const v = validateManualEntryInput(input, stockholmDateKey(new Date()));
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const res = await registerRecord({
    tenant: actor.tenant,
    actorId: actor.id,
    typeKey: v.value.type_key,
    caseId: input.case_id || null,
    title: v.value.title,
    caseTitle: v.value.case_title,
    counterpart: v.value.counterpart,
    documentDate: v.value.document_date,
    secrecy: v.value.secrecy,
    secrecyBasis: v.value.secrecy_basis,
    note: v.value.note,
    snapshot: { manual: true },
    via: 'manual',
    closeCase: input.close_case === true
  });
  if (res.status === 'skipped') return fail('INVALID_VALUE', res.reason);
  if (res.status === 'error') return fail('DB_ERROR', res.reason);
  const su = await superuser();
  if (su) {
    await logAgentAction(su, {
      actor,
      action_type: 'create',
      collection: REGISTER_ENTRIES,
      record_id: res.entryId,
      after_value: { designation: res.designation, type: v.value.type_key, secrecy: v.value.secrecy, case: res.caseId }
    });
  }
  return ok({ entryId: res.entryId, caseId: res.caseId, designation: res.designation });
}

interface EntryRow {
  id: string;
  tenant: string;
  register_case: string;
  designation: string;
  secrecy?: boolean;
  secrecy_basis?: string;
  voided_at?: string;
}

export async function setEntrySecrecy(
  actor: Actor,
  entryId: string,
  input: { secrecy: boolean; basis?: unknown }
): Promise<WriteResult<{ caseId: string }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  const row = await loadInTenant<EntryRow>(su, REGISTER_ENTRIES, entryId, actor.tenant);
  if (!row) return fail('NOT_FOUND', 'Handlingen hittades inte.');
  const basis = input.secrecy ? cleanRegisterText(input.basis, 300) : '';
  try {
    await su.collection(REGISTER_ENTRIES).update(row.id, { secrecy: input.secrecy, secrecy_basis: basis });
  } catch {
    return fail('DB_ERROR', 'Kunde inte spara sekretessmarkeringen.');
  }
  await logAgentAction(su, {
    actor,
    action_type: 'update',
    collection: REGISTER_ENTRIES,
    record_id: row.id,
    field: 'secrecy',
    before_value: { secrecy: row.secrecy === true, has_basis: Boolean(row.secrecy_basis) },
    after_value: { designation: row.designation, secrecy: input.secrecy, has_basis: Boolean(basis), case: row.register_case }
  });
  return ok({ caseId: row.register_case });
}

/** Makulerar en felregistrerad handling. Posten och numret finns kvar. */
export async function voidEntry(actor: Actor, entryId: string, reason: unknown): Promise<WriteResult<{ caseId: string }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const text = cleanRegisterText(reason, 300);
  if (text.length < 3) return fail('INVALID_VALUE', 'Ange varför handlingen makuleras.');
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  const row = await loadInTenant<EntryRow>(su, REGISTER_ENTRIES, entryId, actor.tenant);
  if (!row) return fail('NOT_FOUND', 'Handlingen hittades inte.');
  if (row.voided_at) return fail('STATE_TRANSITION', 'Handlingen är redan makulerad.');
  try {
    await su.collection(REGISTER_ENTRIES).update(row.id, { voided_at: nowIso(), voided_by: actor.id, void_reason: text });
  } catch {
    return fail('DB_ERROR', 'Kunde inte makulera handlingen.');
  }
  await logAgentAction(su, {
    actor,
    action_type: 'update',
    collection: REGISTER_ENTRIES,
    record_id: row.id,
    field: 'voided',
    after_value: { designation: row.designation, voided: true, reason_length: text.length, case: row.register_case }
  });
  return ok({ caseId: row.register_case });
}

export async function setRegisterCaseStatus(actor: Actor, caseId: string, status: 'open' | 'closed'): Promise<WriteResult<{ caseId: string }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  const row = await loadInTenant<{ id: string; tenant: string; number: string; status: string }>(su, REGISTER_CASES, caseId, actor.tenant);
  if (!row) return fail('NOT_FOUND', 'Ärendet hittades inte.');
  if (row.status === status) return ok({ caseId: row.id });
  try {
    await su
      .collection(REGISTER_CASES)
      .update(row.id, status === 'closed' ? { status, closed_at: nowIso(), closed_by: actor.id } : { status, closed_at: null, closed_by: null });
  } catch {
    return fail('DB_ERROR', 'Kunde inte ändra ärendets status.');
  }
  await logAgentAction(su, {
    actor,
    action_type: 'update',
    collection: REGISTER_CASES,
    record_id: row.id,
    field: 'status',
    before_value: row.status,
    after_value: { number: row.number, status }
  });
  return ok({ caseId: row.id });
}

export async function logDisclosure(
  actor: Actor,
  input: DisclosureInput & { case_id?: string | null; entry_id?: string | null }
): Promise<WriteResult<{ disclosureId: string; caseId: string | null }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const v = validateDisclosureInput(input, stockholmDateKey(new Date()));
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  let caseId: string | null = null;
  let entryId: string | null = null;
  if (input.entry_id) {
    const entry = await loadInTenant<EntryRow>(su, REGISTER_ENTRIES, input.entry_id, actor.tenant);
    if (!entry) return fail('NOT_FOUND', 'Handlingen hittades inte.');
    entryId = entry.id;
    caseId = entry.register_case;
  } else if (input.case_id) {
    const c = await loadInTenant<{ id: string; tenant: string }>(su, REGISTER_CASES, input.case_id, actor.tenant);
    if (!c) return fail('NOT_FOUND', 'Ärendet hittades inte.');
    caseId = c.id;
  }
  let created: { id: string };
  try {
    created = await su.collection(REGISTER_DISCLOSURES).create<{ id: string }>({
      tenant: actor.tenant,
      register_case: caseId,
      entry: entryId,
      requested_at: new Date(v.value.requested_at).toISOString(),
      request_summary: v.value.request_summary,
      outcome: v.value.outcome,
      secrecy_basis: v.value.secrecy_basis,
      note: v.value.note,
      handled_by: actor.id
    });
  } catch (err) {
    return fail('DB_ERROR', statusOf(err) === 404 ? REGISTER_MIGRATION_HINT : 'Kunde inte logga utlämnandet.');
  }
  await logAgentAction(su, {
    actor,
    action_type: 'create',
    collection: REGISTER_DISCLOSURES,
    record_id: created.id,
    after_value: { outcome: v.value.outcome, has_basis: Boolean(v.value.secrecy_basis), case: caseId }
  });
  return ok({ disclosureId: created.id, caseId });
}

// ─── Planen ───────────────────────────────────────────────────────────────

export async function saveRecordType(
  actor: Actor,
  input: RecordTypeInput & { confirmed?: unknown; active?: unknown }
): Promise<WriteResult<{ key: string; created: boolean }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const v = validateRecordTypeInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  let types: RecordTypeRow[];
  try {
    types = await ensureRecordPlan(su, actor.tenant);
  } catch (err) {
    return fail('DB_ERROR', statusOf(err) === 404 ? REGISTER_MIGRATION_HINT : 'Planen kunde inte läsas.');
  }
  const existing = types.find((t) => t.key === v.value.key);
  const confirmed = input.confirmed === true || input.confirmed === 'true' || input.confirmed === 'on';
  const active = !(input.active === false || input.active === 'false');
  const payload: Record<string, unknown> = {
    ...v.value,
    retention_months: v.value.retention_months ?? 0,
    active,
    confirmed,
    updated_by: actor.id
  };
  if (confirmed && !existing?.confirmed) {
    payload.confirmed_at = nowIso();
    payload.confirmed_by = actor.id;
  }
  if (!confirmed) {
    payload.confirmed_at = null;
    payload.confirmed_by = null;
  }
  try {
    if (existing) {
      delete payload.key;
      await su.collection(RECORD_TYPES).update(existing.id, payload);
    } else {
      await su.collection(RECORD_TYPES).create({ ...payload, tenant: actor.tenant, source_collection: '', sort_order: 100 + types.length });
    }
  } catch {
    return fail('DB_ERROR', 'Kunde inte spara handlingstypen.');
  }
  await logAgentAction(su, {
    actor,
    action_type: existing ? 'update' : 'create',
    collection: RECORD_TYPES,
    record_id: existing?.id ?? v.value.key,
    before_value: existing ? { handling: existing.handling, retention: existing.retention, retention_months: existing.retention_months, confirmed: existing.confirmed } : undefined,
    after_value: { key: v.value.key, label: v.value.label, handling: v.value.handling, retention: v.value.retention, retention_months: v.value.retention_months, secrecy_possible: v.value.secrecy_possible, confirmed, active }
  });
  return ok({ key: v.value.key, created: !existing });
}

// ─── Arkivbeskrivning och fastställda versioner ───────────────────────────

export async function saveArchiveDescription(actor: Actor, sections: unknown): Promise<WriteResult<{ description: ArchiveDescription }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const description = normalizeArchiveDescription(sections);
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  try {
    let existing: { id: string } | null = null;
    try {
      existing = await su.collection(ARCHIVE_PROFILES).getFirstListItem<{ id: string }>(su.filter('tenant = {:t}', { t: actor.tenant }), { fields: 'id' });
    } catch (err) {
      if (statusOf(err) !== 404) throw err;
    }
    if (existing) await su.collection(ARCHIVE_PROFILES).update(existing.id, { sections: description, updated_by: actor.id });
    else await su.collection(ARCHIVE_PROFILES).create({ tenant: actor.tenant, sections: description, updated_by: actor.id });
  } catch {
    return fail('DB_ERROR', 'Kunde inte spara arkivbeskrivningen.');
  }
  await logAgentAction(su, {
    actor,
    action_type: 'update',
    collection: ARCHIVE_PROFILES,
    record_id: actor.tenant,
    after_value: { filled: Object.values(description).filter(Boolean).length }
  });
  return ok({ description });
}

/**
 * Fastställer plan + arkivförteckning + arkivbeskrivning som en daterad,
 * oföränderlig version (beslutsunderlag vid granskning).
 */
export async function establishArchiveVersion(actor: Actor, note: unknown): Promise<WriteResult<{ version: number }>> {
  const denied = requireManager(actor);
  if (denied) return denied;
  const su = await superuser();
  if (!su) return fail('DB_ERROR', NO_SUPERUSER);
  try {
    const types = await ensureRecordPlan(su, actor.tenant);
    const entries = await su.collection(REGISTER_ENTRIES).getFullList<{ type_key: string; registered_at: string; secrecy?: boolean; voided_at?: string }>({
      filter: su.filter('tenant = {:t}', { t: actor.tenant }),
      fields: 'type_key,registered_at,secrecy,voided_at',
      batch: 500
    });
    const inventory = buildArchiveInventory(
      types.filter((t) => t.active),
      entries.map((e) => ({ type_key: e.type_key, registered_at: e.registered_at, secrecy: e.secrecy === true, voided: Boolean(e.voided_at) }))
    );
    let description = normalizeArchiveDescription(null);
    try {
      const profile = await su.collection(ARCHIVE_PROFILES).getFirstListItem<{ sections?: unknown }>(su.filter('tenant = {:t}', { t: actor.tenant }));
      description = normalizeArchiveDescription(profile.sections);
    } catch (err) {
      if (statusOf(err) !== 404) throw err;
    }
    const plan = types.map(({ id: _id, updated: _updated, ...rest }) => rest);
    const version = (await su.collection(ARCHIVE_VERSIONS).getList<{ version: number }>(1, 1, { filter: su.filter('tenant = {:t}', { t: actor.tenant }), sort: '-version', fields: 'version' })).items[0]?.version ?? 0;
    const next = version + 1;
    const created = await su.collection(ARCHIVE_VERSIONS).create<{ id: string }>({
      tenant: actor.tenant,
      version: next,
      established_at: nowIso(),
      established_by: actor.id,
      note: cleanRegisterText(note, 400),
      plan,
      inventory,
      description,
      content_hash: sha256(JSON.stringify({ plan, inventory, description }))
    });
    await logAgentAction(su, {
      actor,
      action_type: 'create',
      collection: ARCHIVE_VERSIONS,
      record_id: created.id,
      after_value: { version: next, types: plan.length, unconfirmed: types.filter((t) => t.active && !t.confirmed).length }
    });
    return ok({ version: next });
  } catch (err) {
    return fail('DB_ERROR', statusOf(err) === 404 ? REGISTER_MIGRATION_HINT : 'Kunde inte fastställa versionen.');
  }
}

// ─── Integritetskontroll ──────────────────────────────────────────────────

/**
 * Räknar om kontrollsumman för varje handling ur den lagrade posten och
 * jämför. En avvikelse betyder att posten ändrats utanför skrivlagret.
 */
export async function verifyRegisterIntegrity(tenant: string): Promise<{ ok: boolean; checked: number; mismatched: string[]; error?: string }> {
  const su = await superuser();
  if (!su) return { ok: false, checked: 0, mismatched: [], error: NO_SUPERUSER };
  try {
    const rows = await su.collection(REGISTER_ENTRIES).getFullList<Record<string, unknown>>({ filter: su.filter('tenant = {:t}', { t: tenant }), batch: 500 });
    const mismatched: string[] = [];
    for (const r of rows) {
      const expected = sha256(
        registerEntryHashPayload({
          type_key: String(r.type_key ?? ''),
          title: String(r.title ?? ''),
          direction: r.direction as RecordDirection,
          document_date: r.document_date ? new Date(String(r.document_date)).toISOString() : '',
          source_collection: String(r.source_collection ?? ''),
          source_id: String(r.source_id ?? ''),
          source_event: String(r.source_event ?? ''),
          document_hash: String(r.document_hash ?? ''),
          snapshot: r.snapshot ?? {}
        })
      );
      if (expected !== r.content_hash) mismatched.push(String(r.designation ?? r.id));
    }
    return { ok: mismatched.length === 0, checked: rows.length, mismatched: mismatched.slice(0, 50) };
  } catch (err) {
    return { ok: false, checked: 0, mismatched: [], error: statusOf(err) === 404 ? REGISTER_MIGRATION_HINT : 'Kontrollen kunde inte köras.' };
  }
}
