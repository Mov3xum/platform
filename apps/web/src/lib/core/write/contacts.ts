import 'server-only';
import type PocketBase from 'pocketbase';
import {
  CONTACT_BOOK_ROLES,
  canDecideContactRequest,
  canWithdrawContactRequest,
  clipText,
  contactDedupeKey,
  contactDisplayName,
  contactRequestTransition,
  isSelfApprovedRequest,
  isValidEmail,
  normalizeContactCategory,
  normalizeContactEmail,
  type ContactCategory,
  type ContactImportRow,
  type ContactRequestDecision,
  type ContactRequestStatus
} from '@platform/shared';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { notify } from '@/lib/notifications-server';
import {
  CONTACTS,
  CONTACT_REQUESTS,
  STARTUP_CONTACTS,
  getContact,
  getContactRequest,
  listStaffUsers,
  normalizeContact,
  type ContactRow
} from '@/lib/contacts/data';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { validateNonEmptyText, validateOptionalText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Kontaktboken (CLAUDE.md § 45) — det delade skrivlagret. UI-actions och
 * chatt-verktyg går HÄR igenom: rollpolicy (`writable-fields.ts`), validering,
 * tenant-stämpel från actorn och `agent_actions`-audit.
 *
 * PII-regler:
 * - E-post/telefon skrivs till posten men loggas ALDRIG i audit (bara att
 *   fältet ändrades). Feed-rader bygger på namn + organisation.
 * - `info`, `purpose`, `decision_note` personnummer-saneras (§ 15.6-regexen).
 * - `gdpr_consent` MÅSTE vara sant för att en kontakt ska skapas (§ 15.4) —
 *   personen ska ha informerats/samtyckt enligt Movexums GDPR-rutin.
 * - Ägare valideras mot tenantens Movexum-personal (aldrig bolagsmedlemmar).
 *
 * Förfrågningar (§ 45.3): en avgjord förfrågan är slutgiltig; godkännande med
 * bolag skapar kopplingen i `startup_contacts` (idempotent på unikt index).
 */

export const CONTACT_WRITABLE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'organization',
  'primary_role',
  'category',
  'kommun',
  'skills',
  'info',
  'owners',
  'gender'
] as const;
export type ContactWritableField = (typeof CONTACT_WRITABLE_FIELDS)[number];

const GENDER_VALUES = ['kvinna', 'man', 'icke_binar', 'uppger_ej'] as const;

export interface ContactInput {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  primaryRole?: string | null;
  category?: string | null;
  kommun?: string | null;
  skills?: string | null;
  info?: string | null;
  /** Interna ägare (user-id:n). Tom → actorn själv. Agent får inte sätta. */
  ownerIds?: string[] | null;
  gender?: string | null;
  /** Personen har informerats/samtyckt (§ 15.4). Krävs vid skapande. */
  gdprConsent: boolean;
}

export interface ContactResult {
  contactId: string;
  name: string;
  organization: string | null;
  ownerIds: string[];
  path: string;
}

export type ContactChanges = Partial<Record<ContactWritableField, unknown>>;

export function contactPath(id: string): string {
  return `/kontakter/${id}`;
}

type Validated = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Validerar ETT fält och returnerar det PB-värde som ska skrivas. */
function validateField(field: ContactWritableField, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (field) {
    case 'first_name': {
      const r = validateNonEmptyText(value, 'Förnamn', 100);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'last_name': {
      const r = validateOptionalText(value, 'Efternamn', 100);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'email': {
      if (value === null || value === undefined || value === '') return { ok: true, value: '' };
      const email = normalizeContactEmail(value);
      if (!email || !isValidEmail(email)) return { ok: false, error: 'E-postadressen är ogiltig.' };
      return { ok: true, value: email };
    }
    case 'phone': {
      const r = validateOptionalText(value, 'Telefon', 30);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'organization': {
      const r = validateOptionalText(value, 'Organisation', 200);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'primary_role': {
      const r = validateOptionalText(value, 'Titel/roll', 100);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'kommun': {
      const r = validateOptionalText(value, 'Kommun', 100);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'skills': {
      const r = validateOptionalText(value, 'Kompetenser', 1000);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case 'info': {
      const r = validateOptionalText(value, 'Info', 4000);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'category': {
      if (value === null || value === undefined || value === '') return { ok: true, value: '' };
      const cat = normalizeContactCategory(value);
      if (!cat) return { ok: false, error: 'Kategorin är ogiltig.' };
      return { ok: true, value: cat satisfies ContactCategory };
    }
    case 'gender': {
      if (value === null || value === undefined || value === '') return { ok: true, value: '' };
      if (typeof value !== 'string' || !(GENDER_VALUES as readonly string[]).includes(value)) {
        return { ok: false, error: `Kön måste vara en av: ${GENDER_VALUES.join(', ')}.` };
      }
      return { ok: true, value };
    }
    case 'owners': {
      if (!Array.isArray(value)) return { ok: false, error: 'Ägare måste vara en lista av användar-id:n.' };
      const idsList = [...new Set(value.filter((v): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(v)))];
      return { ok: true, value: idsList };
    }
    default:
      return { ok: false, error: `Okänt fält: ${String(field)}.` };
  }
}

/** Behåller bara ägar-id:n som är Movexum-personal i actorns tenant. */
async function validOwnerIds(pb: PocketBase, actor: Actor, candidates: readonly string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const staff = await listStaffUsers(pb, actor.tenant);
  const allowed = new Set(staff.map((u) => u.id));
  return candidates.filter((id) => allowed.has(id));
}

function isDbErrorWithStatus(err: unknown, status: number): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === status;
}

async function findByEmail(pb: PocketBase, tenantId: string, email: string): Promise<ContactRow | null> {
  try {
    const res = await pb.collection(CONTACTS).getList<Record<string, unknown>>(1, 1, {
      filter: pb.filter('tenant = {:tenant} && email = {:email}', { tenant: tenantId, email })
    });
    return res.items[0] ? normalizeContact(res.items[0]) : null;
  } catch {
    return null;
  }
}

/** Bygger ett validerat PB-payload ur ett ContactInput (create-vägen). */
async function buildCreatePayload(pb: PocketBase, actor: Actor, input: ContactInput): Promise<Validated> {
  const payload: Record<string, unknown> = { tenant: actor.tenant, created_by: actor.id };
  const map: Array<[ContactWritableField, unknown]> = [
    ['first_name', input.firstName],
    ['last_name', input.lastName ?? ''],
    ['email', input.email ?? ''],
    ['phone', input.phone ?? ''],
    ['organization', input.organization ?? ''],
    ['primary_role', input.primaryRole ?? ''],
    ['category', input.category ?? ''],
    ['kommun', input.kommun ?? ''],
    ['skills', input.skills ?? ''],
    ['info', input.info ?? '']
  ];
  for (const [field, value] of map) {
    const r = validateField(field, value);
    if (!r.ok) return r;
    payload[field] = r.value;
  }
  if (input.gender) {
    const policy = canWriteField(actor, CONTACTS, 'gender');
    if (!policy.ok) return { ok: false, error: policy.reason ?? 'Kön får inte sättas.' };
    const r = validateField('gender', input.gender);
    if (!r.ok) return r;
    payload.gender = r.value;
  }
  // Ägare: människa får peka ut kollegor; agenten får aldrig (kan inte slå upp
  // användar-id:n, `users` är denylistad § 9.3) → actorn blir ägare.
  let owners: string[] = [];
  if (input.ownerIds && input.ownerIds.length > 0) {
    const policy = canWriteField(actor, CONTACTS, 'owners');
    if (!policy.ok) return { ok: false, error: policy.reason ?? 'Ägare får inte sättas.' };
    const r = validateField('owners', input.ownerIds);
    if (!r.ok) return r;
    owners = await validOwnerIds(pb, actor, r.value as string[]);
    if (owners.length === 0) {
      return { ok: false, error: 'Ingen av de angivna ägarna är Movexum-personal i din organisation.' };
    }
  }
  if (owners.length === 0) owners = [actor.id];
  payload.owners = owners;
  if (input.gdprConsent !== true) {
    return {
      ok: false,
      error:
        'Bekräfta att personen har informerats om att uppgifterna lagras (GDPR-samtycke) innan kontakten skapas.'
    };
  }
  payload.gdpr_consent = true;
  payload.gdpr_consent_at = new Date().toISOString();
  return { ok: true, value: payload };
}

function auditSafe(payload: Record<string, unknown>): Record<string, unknown> {
  // Aldrig e-post/telefon/kön/info i audit — bara verksamhetsdata.
  return {
    name: contactDisplayName({
      first_name: String(payload.first_name ?? ''),
      last_name: String(payload.last_name ?? '')
    }),
    organization: payload.organization || undefined,
    category: payload.category || undefined,
    owners: Array.isArray(payload.owners) ? payload.owners : undefined
  };
}

export async function createContact(
  pb: PocketBase,
  actor: Actor,
  input: ContactInput
): Promise<WriteResult<ContactResult>> {
  const policy = canCreateRecord(actor, CONTACTS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skapande nekat.');

  const built = await buildCreatePayload(pb, actor, input);
  if (!built.ok) return fail('INVALID_VALUE', built.error);
  const payload = built.value;

  const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
  if (email) {
    const existing = await findByEmail(pb, actor.tenant, email);
    if (existing) {
      return fail(
        'INVALID_VALUE',
        `Det finns redan en kontakt med den e-postadressen: ${contactDisplayName(existing)} (id ${existing.id}). Uppdatera den i stället.`
      );
    }
  }

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) => client.collection(CONTACTS).create<{ id: string }>(payload));
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara kontakten.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CONTACTS,
    record_id: created.id,
    after_value: auditSafe(payload)
  });

  return ok({
    contactId: created.id,
    name: contactDisplayName({ first_name: String(payload.first_name), last_name: String(payload.last_name ?? '') }),
    organization: (payload.organization as string) || null,
    ownerIds: payload.owners as string[],
    path: contactPath(created.id)
  });
}

export async function updateContactFields(
  pb: PocketBase,
  actor: Actor,
  contactId: string,
  changes: ContactChanges
): Promise<WriteResult<ContactResult & { updatedFields: string[] }>> {
  const contact = await getRecordInTenant<ContactRow & { tenant: string }>(
    pb,
    actor,
    CONTACTS,
    contactId.trim(),
    'id,tenant,first_name,last_name,organization,owners,email'
  );
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte i din organisation.');

  const patch: Record<string, unknown> = {};
  const audits: Array<{ field: string; before?: unknown; after?: unknown }> = [];
  for (const [field, raw] of Object.entries(changes) as Array<[ContactWritableField, unknown]>) {
    if (!(CONTACT_WRITABLE_FIELDS as readonly string[]).includes(field)) {
      return fail('FIELD_NOT_WRITABLE', `Fältet '${field}' kan inte ändras.`);
    }
    const policy = canWriteField(actor, CONTACTS, field);
    if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
    const r = validateField(field, raw);
    if (!r.ok) return fail('INVALID_VALUE', r.error);
    let value = r.value;
    if (field === 'owners') {
      const owners = await validOwnerIds(pb, actor, value as string[]);
      if (owners.length === 0) return fail('INVALID_VALUE', 'En kontakt måste ha minst en ägare som är Movexum-personal.');
      value = owners;
    }
    if (field === 'email' && typeof value === 'string' && value) {
      const dup = await findByEmail(pb, actor.tenant, value);
      if (dup && dup.id !== contact.id) {
        return fail('INVALID_VALUE', `E-postadressen används redan av ${contactDisplayName(dup)}.`);
      }
    }
    patch[field] = value;
    const pii = field === 'email' || field === 'phone' || field === 'gender' || field === 'info';
    audits.push(
      pii
        ? { field }
        : { field, before: (contact as unknown as Record<string, unknown>)[field], after: value }
    );
  }
  if (Object.keys(patch).length === 0) return fail('INVALID_VALUE', 'Inga ändringar angavs.');

  let updated: Record<string, unknown>;
  try {
    updated = await writeWithFallback(pb, (client) =>
      client.collection(CONTACTS).update<Record<string, unknown>>(contact.id, patch)
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte uppdatera kontakten.');
  }
  const row = normalizeContact(updated);

  for (const a of audits) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: CONTACTS,
      record_id: contact.id,
      field: a.field,
      before_value: a.before,
      after_value: { ...(a.after !== undefined ? { value: a.after } : {}), name: contactDisplayName(row) }
    });
  }

  return ok({
    contactId: contact.id,
    name: contactDisplayName(row),
    organization: row.organization,
    ownerIds: row.owners,
    path: contactPath(contact.id),
    updatedFields: Object.keys(patch)
  });
}

/** Radering — bara admin/incubator_lead (server-action). Auditas som update + deleted. */
export async function deleteContact(pb: PocketBase, actor: Actor, contactId: string): Promise<WriteResult<{ name: string }>> {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Kontakter raderas av en människa i kontaktboken.');
  if (!actor.roles.some((r) => r === 'admin' || r === 'incubator_lead')) {
    return fail('FORBIDDEN', 'Bara admin eller incubator lead kan radera kontakter.');
  }
  const contact = await getContact(pb, actor.tenant, contactId);
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (client) => client.collection(CONTACTS).delete(contact.id), { fallbackOn404: true });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte radera kontakten.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACTS,
    record_id: contact.id,
    after_value: { deleted: true, name: contactDisplayName(contact), organization: contact.organization ?? undefined }
  });
  return ok({ name: contactDisplayName(contact) });
}

// ── Förfrågningar ───────────────────────────────────────────────────────────

export interface RequestContactUseParams {
  contactId: string;
  purpose: string;
  startupId?: string | null;
  startupRole?: string | null;
}

export interface ContactRequestResult {
  requestId: string;
  status: ContactRequestStatus;
  contactId: string;
  contactName: string;
  startupId: string | null;
  startupName: string | null;
  /** Ägare som notifierats (visningsnamn saknas här — id:n). */
  ownerIds: string[];
  path: string;
  /** true när frågaren själv är ägare och förfrågan godkändes direkt. */
  selfApproved: boolean;
  /** Icke-blockerande varning (t.ex. bolagskopplingen kunde inte skapas). */
  warning?: string;
}

async function ensureStartupLink(
  pb: PocketBase,
  startupId: string,
  contactId: string,
  role: string | null
): Promise<{ linked: boolean; error?: string }> {
  try {
    const existing = await pb.collection(STARTUP_CONTACTS).getList<{ id: string; role?: string }>(1, 1, {
      filter: pb.filter('startup = {:startup} && contact = {:contact}', { startup: startupId, contact: contactId }),
      fields: 'id,role'
    });
    if (existing.items[0]) {
      if (role && !existing.items[0].role) {
        await writeWithFallback(pb, (c) => c.collection(STARTUP_CONTACTS).update(existing.items[0].id, { role })).catch(
          () => undefined
        );
      }
      return { linked: true };
    }
  } catch {
    /* faller igenom till create */
  }
  try {
    await writeWithFallback(pb, (c) =>
      c.collection(STARTUP_CONTACTS).create({ startup: startupId, contact: contactId, role: role ?? '' })
    );
    return { linked: true };
  } catch (err) {
    // Unikt index (startup, contact) → 400 = finns redan (parallell skrivning).
    if (isDbErrorWithStatus(err, 400)) return { linked: true };
    return { linked: false, error: err instanceof Error ? err.message : 'Kunde inte koppla kontakten till bolaget.' };
  }
}

/** Admin/incubator_lead i tenanten — mottagare när en kontakt saknar ägare. */
async function adminRecipients(pb: PocketBase, tenantId: string): Promise<string[]> {
  const staff = await listStaffUsers(pb, tenantId);
  return staff.filter((u) => u.roles.includes('admin') || u.roles.includes('incubator_lead')).map((u) => u.id);
}

export async function requestContactUse(
  pb: PocketBase,
  actor: Actor,
  params: RequestContactUseParams
): Promise<WriteResult<ContactRequestResult>> {
  const policy = canCreateRecord(actor, CONTACT_REQUESTS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');

  const purposeRaw = validateNonEmptyText(params.purpose, 'Syfte', 2000);
  if (!purposeRaw.ok) return fail('INVALID_VALUE', purposeRaw.error);
  const purpose = sanitizePersonnummer(purposeRaw.value);
  const roleRaw = validateOptionalText(params.startupRole, 'Roll gentemot bolaget', 100);
  if (!roleRaw.ok) return fail('INVALID_VALUE', roleRaw.error);

  const contact = await getContact(pb, actor.tenant, params.contactId.trim());
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte i din organisation.');

  let startup: { id: string; name?: string } | null = null;
  if (params.startupId && params.startupId.trim()) {
    startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
      pb,
      actor,
      'startups',
      params.startupId.trim(),
      'id,tenant,name'
    );
    if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
  }

  const ownerIds = contact.owners;
  const selfApproved = isSelfApprovedRequest({ requesterId: actor.id, ownerIds });
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    contact: contact.id,
    requester: actor.id,
    owners: ownerIds,
    purpose,
    startup: startup?.id ?? null,
    startup_role: roleRaw.value || '',
    status: selfApproved ? 'approved' : 'pending'
  };
  if (selfApproved) {
    payload.decided_by = actor.id;
    payload.decided_at = now;
    payload.decision_note = 'Godkänd direkt — frågaren är ägare till kontakten.';
  }

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) => client.collection(CONTACT_REQUESTS).create<{ id: string }>(payload));
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa förfrågan.');
  }

  let warning: string | undefined;
  if (selfApproved && startup) {
    const link = await ensureStartupLink(pb, startup.id, contact.id, roleRaw.value || null);
    if (!link.linked) warning = link.error;
  }

  const contactName = contactDisplayName(contact);
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CONTACT_REQUESTS,
    record_id: created.id,
    after_value: {
      contact: contact.id,
      contact_name: contactName,
      startup: startup?.id,
      startup_name: startup?.name,
      status: payload.status,
      purpose: clipText(purpose, 160)
    }
  });

  if (!selfApproved) {
    const recipients = ownerIds.length > 0 ? ownerIds : await adminRecipients(pb, actor.tenant);
    await notify(pb, {
      tenant: actor.tenant,
      recipients,
      kind: 'contact_request',
      actorId: actor.id,
      payload: {
        title: `Förfrågan: använda ${contactName}`,
        snippet: `${startup?.name ? `Dela med ${startup.name}. ` : ''}${clipText(purpose, 140)}`,
        href: `${contactPath(contact.id)}?request=${created.id}`
      }
    }).catch(() => undefined);
  }

  const result: ContactRequestResult = {
    requestId: created.id,
    status: selfApproved ? 'approved' : 'pending',
    contactId: contact.id,
    contactName,
    startupId: startup?.id ?? null,
    startupName: startup?.name ?? null,
    ownerIds,
    path: `${contactPath(contact.id)}?request=${created.id}`,
    selfApproved
  };
  return ok(warning ? { ...result, warning } : result);
}

export interface DecideContactRequestParams {
  requestId: string;
  decision: ContactRequestDecision;
  note?: string | null;
}

export interface DecidedContactRequestResult {
  requestId: string;
  status: ContactRequestStatus;
  contactId: string;
  contactName: string;
  startupId: string | null;
  startupName: string | null;
  requesterId: string;
  path: string;
  linked: boolean;
  warning?: string;
}

export async function decideContactRequest(
  pb: PocketBase,
  actor: Actor,
  params: DecideContactRequestParams
): Promise<WriteResult<DecidedContactRequestResult>> {
  if (!actor.roles.some((r) => CONTACT_BOOK_ROLES.includes(r))) {
    return fail('FORBIDDEN', 'Bara Movexum-personal kan avgöra förfrågningar.');
  }
  if (params.decision !== 'approved' && params.decision !== 'declined') {
    return fail('INVALID_VALUE', 'Beslutet måste vara approved eller declined.');
  }
  const noteRaw = validateOptionalText(params.note, 'Kommentar', 2000);
  if (!noteRaw.ok) return fail('INVALID_VALUE', noteRaw.error);
  const note = sanitizePersonnummer(noteRaw.value);

  const request = await getContactRequest(pb, actor.tenant, params.requestId.trim());
  if (!request) return fail('NOT_FOUND', 'Förfrågan hittades inte i din organisation.');
  const contact = await getContact(pb, actor.tenant, request.contact);
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte längre.');

  // Ägarna NU (inte snapshotten) avgör — en nytillkommen ägare ska kunna svara.
  const ownerIds = contact.owners.length > 0 ? contact.owners : request.owners;
  if (!canDecideContactRequest({ userId: actor.id, roles: actor.roles, ownerIds })) {
    return fail('FORBIDDEN', 'Bara kontaktens ägare (eller admin/incubator lead) kan avgöra förfrågan.');
  }
  const transition = contactRequestTransition(request.status, params.decision);
  if (!transition.ok) return fail('STATE_TRANSITION', transition.error);

  const now = new Date().toISOString();
  try {
    await writeWithFallback(
      pb,
      (client) =>
        client.collection(CONTACT_REQUESTS).update(request.id, {
          status: params.decision,
          decided_by: actor.id,
          decided_at: now,
          decision_note: note
        }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara beslutet.');
  }

  let linked = false;
  let linkError: string | undefined;
  if (params.decision === 'approved' && request.startup) {
    const link = await ensureStartupLink(pb, request.startup, contact.id, request.startup_role);
    linked = link.linked;
    linkError = link.error;
  }

  const contactName = contactDisplayName(contact);
  const startupName = request.expand?.startup?.name ?? null;
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACT_REQUESTS,
    record_id: request.id,
    field: 'status',
    before_value: request.status,
    after_value: {
      value: params.decision,
      contact: contact.id,
      contact_name: contactName,
      startup: request.startup ?? undefined,
      startup_name: startupName ?? undefined,
      linked
    }
  });

  await notify(pb, {
    tenant: actor.tenant,
    recipients: [request.requester],
    kind: 'contact_decision',
    actorId: actor.id,
    payload: {
      title:
        params.decision === 'approved'
          ? `Godkänt: du kan använda ${contactName}`
          : `Avböjt: ${contactName}`,
      snippet: note ? clipText(note, 140) : startupName && linked ? `Kontakten är nu kopplad till ${startupName}.` : undefined,
      href: `${contactPath(contact.id)}?request=${request.id}`
    }
  }).catch(() => undefined);

  const value: DecidedContactRequestResult = {
    requestId: request.id,
    status: params.decision,
    contactId: contact.id,
    contactName,
    startupId: request.startup,
    startupName,
    requesterId: request.requester,
    path: `${contactPath(contact.id)}?request=${request.id}`,
    linked
  };
  return ok(linkError ? { ...value, linked: false, warning: linkError } : value);
}

export async function withdrawContactRequest(
  pb: PocketBase,
  actor: Actor,
  requestId: string
): Promise<WriteResult<{ requestId: string; contactId: string; path: string }>> {
  const request = await getContactRequest(pb, actor.tenant, requestId.trim());
  if (!request) return fail('NOT_FOUND', 'Förfrågan hittades inte i din organisation.');
  if (!canWithdrawContactRequest({ userId: actor.id, roles: actor.roles, requesterId: request.requester })) {
    return fail('FORBIDDEN', 'Bara den som skickade förfrågan kan återkalla den.');
  }
  const transition = contactRequestTransition(request.status, 'withdrawn');
  if (!transition.ok) return fail('STATE_TRANSITION', transition.error);
  try {
    await writeWithFallback(
      pb,
      (client) =>
        client.collection(CONTACT_REQUESTS).update(request.id, {
          status: 'withdrawn',
          decided_by: actor.id,
          decided_at: new Date().toISOString()
        }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte återkalla förfrågan.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACT_REQUESTS,
    record_id: request.id,
    field: 'status',
    before_value: request.status,
    after_value: { value: 'withdrawn', contact: request.contact, contact_name: request.expand?.contact ? contactDisplayName({ first_name: request.expand.contact.first_name ?? '', last_name: request.expand.contact.last_name ?? '' }) : undefined }
  });
  return ok({ requestId: request.id, contactId: request.contact, path: `${contactPath(request.contact)}?request=${request.id}` });
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportContactsOptions {
  /** Ägare för rader utan (eller med okänd) "Ägare"-kolumn. Default = actorn. */
  defaultOwnerIds?: string[];
  /** Importören bekräftar att kontakterna informerats/samtyckt (§ 15.4). */
  consentConfirmed: boolean;
  /** true = räkna bara, skriv inget. */
  dryRun?: boolean;
}

export interface ImportContactsResult {
  created: number;
  updated: number;
  skipped: number;
  /** PII-fria varningar (radnummer). */
  warnings: string[];
  dryRun: boolean;
}

/**
 * Upsert:ar importrader mot kontaktboken. Nyckel = e-post (annars namn +
 * organisation). Befintliga rader uppdateras bara med icke-tomma värden ur
 * importen och får importens ägare tillagda (aldrig borttagna). Loggar EN
 * sammanfattningsrad i `agent_actions` (inte en per kontakt — feeden ska inte
 * spammas), samma mönster som upphandlingssynken (§ 39.2).
 */
export async function importContacts(
  pb: PocketBase,
  actor: Actor,
  rows: readonly ContactImportRow[],
  options: ImportContactsOptions
): Promise<WriteResult<ImportContactsResult>> {
  const policy = canCreateRecord(actor, CONTACTS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Massimport görs av en människa i kontaktboken.');

  const staff = await listStaffUsers(pb, actor.tenant);
  const staffByEmail = new Map(staff.filter((u) => u.email).map((u) => [u.email as string, u.id]));
  const staffIds = new Set(staff.map((u) => u.id));
  const defaultOwners = (options.defaultOwnerIds ?? []).filter((id) => staffIds.has(id));
  if (defaultOwners.length === 0) defaultOwners.push(actor.id);

  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Befintliga kontakter i tenanten för dedupe (e-post + namn/org).
  const existing = new Map<string, ContactRow>();
  try {
    const all = await pb.collection(CONTACTS).getFullList<Record<string, unknown>>({
      filter: pb.filter('tenant = {:tenant}', { tenant: actor.tenant }),
      batch: 200
    });
    for (const raw of all) {
      const c = normalizeContact(raw);
      existing.set(contactDedupeKey(c), c);
    }
  } catch {
    warnings.push('Kunde inte läsa befintliga kontakter — dubblettkontrollen kan vara ofullständig.');
  }

  for (const row of rows) {
    const consent = row.gdpr_consent === true || (row.gdpr_consent === null && options.consentConfirmed);
    if (!consent) {
      skipped++;
      warnings.push(`Rad ${row.line}: saknar GDPR-samtycke — hoppas över (§ 15.4).`);
      continue;
    }
    let owners = [...defaultOwners];
    if (row.owner_email) {
      const id = staffByEmail.get(row.owner_email);
      if (id) owners = [id];
      else warnings.push(`Rad ${row.line}: ägarens e-post matchar ingen Movexum-kollega — importörens standardägare används.`);
    }
    const key = contactDedupeKey(row);
    const match = existing.get(key);
    const values: Record<string, unknown> = {
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email ?? '',
      phone: row.phone ?? '',
      organization: row.organization ?? '',
      primary_role: row.primary_role ?? '',
      category: row.category ?? '',
      kommun: row.kommun ?? '',
      skills: row.skills ?? '',
      info: row.info ? sanitizePersonnummer(row.info) : ''
    };
    for (const [field, value] of Object.entries(values)) {
      const r = validateField(field as ContactWritableField, value);
      if (!r.ok) {
        warnings.push(`Rad ${row.line}: ${r.error}`);
        values[field] = '';
      } else {
        values[field] = r.value;
      }
    }

    if (match) {
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(values)) {
        const cur = (match as unknown as Record<string, unknown>)[field];
        if (value !== '' && value !== cur) patch[field] = value;
      }
      const mergedOwners = [...new Set([...match.owners, ...owners])];
      if (mergedOwners.length !== match.owners.length) patch.owners = mergedOwners;
      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }
      if (!options.dryRun) {
        try {
          await writeWithFallback(pb, (client) => client.collection(CONTACTS).update(match.id, patch));
        } catch (err) {
          warnings.push(`Rad ${row.line}: kunde inte uppdatera befintlig kontakt (${err instanceof Error ? err.message : 'fel'}).`);
          skipped++;
          continue;
        }
      }
      updated++;
      continue;
    }

    const payload = {
      ...values,
      tenant: actor.tenant,
      created_by: actor.id,
      owners,
      gdpr_consent: true,
      gdpr_consent_at: new Date().toISOString()
    };
    if (!options.dryRun) {
      try {
        const rec = await writeWithFallback(pb, (client) => client.collection(CONTACTS).create<Record<string, unknown>>(payload));
        existing.set(key, normalizeContact(rec));
      } catch (err) {
        warnings.push(`Rad ${row.line}: kunde inte skapa kontakten (${err instanceof Error ? err.message : 'fel'}).`);
        skipped++;
        continue;
      }
    } else {
      existing.set(key, normalizeContact({ ...payload, id: `dry-${row.line}` }));
    }
    created++;
  }

  if (!options.dryRun && (created > 0 || updated > 0)) {
    await logAgentAction(pb, {
      actor,
      action_type: 'create',
      collection: 'contact_import',
      record_id: `import-${Date.now()}`,
      after_value: { created, updated, skipped }
    });
  }

  return ok({ created, updated, skipped, warnings, dryRun: options.dryRun === true });
}
