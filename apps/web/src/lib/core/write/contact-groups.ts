import 'server-only';
import type PocketBase from 'pocketbase';
import {
  CONTACT_GROUP_MAX_BULK,
  contactDisplayName,
  isContactGroupId,
  nextContactGroups,
  sameIdSet,
  validateContactGroupInput
} from '@platform/shared';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { CONTACTS, CONTACT_GROUPS, listContactGroups } from '@/lib/contacts/data';
import { chunk, mapWithConcurrency } from '@/lib/read-scaling';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Grupper i kontaktboken (CLAUDE.md § 45.8) — det delade skrivlagret.
 *
 * - Gruppen bär bara namn + beskrivning (personnummer-saneras ändå).
 * - Medlemskapet ligger på kontakten (`contacts.groups`); en raderad grupp
 *   tas bort från kontakterna av PocketBase (icke-obligatorisk relation).
 * - Bara Movexum-personal (policy `contact_groups`, agent nekad). Tenant
 *   verifieras på varje grupp och kontakt i koden; superuser bara som
 *   reserv vid PB v0.23.4:s tysta regel-nekande (§ 21.3).
 * - Audit är PII-fri: gruppnamn och antal — aldrig kontaktnamn.
 */

export const CONTACT_GROUPS_MIGRATION_HINT =
  'Grupper i kontaktboken saknas i databasen — kör migration 1700000199 (eller workflowen "Sync PocketBase").';

export interface ContactGroupResult {
  groupId: string;
  name: string;
  path: string;
}

export function contactGroupPath(id: string): string {
  return `/kontakter?grupp=${encodeURIComponent(id)}`;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function guard(actor: Actor): WriteResult<void> | null {
  const policy = canCreateRecord(actor, CONTACT_GROUPS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
  return null;
}

async function otherGroupNames(pb: PocketBase, actor: Actor, exceptId?: string): Promise<WriteResult<string[]>> {
  const res = await listContactGroups(pb, actor.tenant);
  if (res.missing) return fail('DB_ERROR', CONTACT_GROUPS_MIGRATION_HINT);
  if (res.error) return fail('DB_ERROR', res.error);
  return ok(res.groups.filter((g) => g.id !== exceptId).map((g) => g.name));
}

function cleanInput(raw: { name?: unknown; description?: unknown }) {
  return {
    name: typeof raw.name === 'string' ? sanitizePersonnummer(raw.name) : raw.name,
    description: typeof raw.description === 'string' ? sanitizePersonnummer(raw.description) : raw.description
  };
}

async function loadGroup(pb: PocketBase, actor: Actor, groupId: string) {
  if (!isContactGroupId(groupId)) return null;
  return getRecordInTenant<{ id: string; tenant: string; name: string }>(pb, actor, CONTACT_GROUPS, groupId, 'id,tenant,name');
}

export async function createContactGroup(
  pb: PocketBase,
  actor: Actor,
  input: { name?: unknown; description?: unknown }
): Promise<WriteResult<ContactGroupResult>> {
  const denied = guard(actor);
  if (denied) return denied as WriteResult<ContactGroupResult>;
  const names = await otherGroupNames(pb, actor);
  if (!names.ok) return names;
  const v = validateContactGroupInput(cleanInput(input), names.value);
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(CONTACT_GROUPS).create<{ id: string }>({
        tenant: actor.tenant,
        name: v.value.name,
        description: v.value.description,
        created_by: actor.id
      })
    );
  } catch (err) {
    if (statusOf(err) === 404) return fail('DB_ERROR', CONTACT_GROUPS_MIGRATION_HINT);
    return fail('DB_ERROR', 'Kunde inte skapa gruppen.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CONTACT_GROUPS,
    record_id: created.id,
    after_value: { name: v.value.name }
  });
  return ok({ groupId: created.id, name: v.value.name, path: contactGroupPath(created.id) });
}

export async function updateContactGroup(
  pb: PocketBase,
  actor: Actor,
  groupId: string,
  input: { name?: unknown; description?: unknown }
): Promise<WriteResult<ContactGroupResult>> {
  const denied = guard(actor);
  if (denied) return denied as WriteResult<ContactGroupResult>;
  const group = await loadGroup(pb, actor, groupId);
  if (!group) return fail('NOT_FOUND', 'Gruppen hittades inte i din organisation.');
  const names = await otherGroupNames(pb, actor, group.id);
  if (!names.ok) return names;
  const v = validateContactGroupInput(cleanInput(input), names.value);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  try {
    await writeWithFallback(
      pb,
      (client) => client.collection(CONTACT_GROUPS).update(group.id, { name: v.value.name, description: v.value.description }),
      { fallbackOn404: true }
    );
  } catch {
    return fail('DB_ERROR', 'Kunde inte spara gruppen.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACT_GROUPS,
    record_id: group.id,
    field: 'name',
    before_value: group.name,
    after_value: { name: v.value.name }
  });
  return ok({ groupId: group.id, name: v.value.name, path: contactGroupPath(group.id) });
}

/** Tar bort gruppen. Kontakterna finns kvar — bara medlemskapet försvinner. */
export async function deleteContactGroup(pb: PocketBase, actor: Actor, groupId: string): Promise<WriteResult<{ name: string }>> {
  const denied = guard(actor);
  if (denied) return denied as WriteResult<{ name: string }>;
  const group = await loadGroup(pb, actor, groupId);
  if (!group) return fail('NOT_FOUND', 'Gruppen hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (client) => client.collection(CONTACT_GROUPS).delete(group.id), { fallbackOn404: true });
  } catch {
    return fail('DB_ERROR', 'Kunde inte ta bort gruppen.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACT_GROUPS,
    record_id: group.id,
    after_value: { deleted: true, name: group.name }
  });
  return ok({ name: group.name });
}

type ContactGroupsRow = { id: string; tenant: string; groups?: unknown };

function groupIdsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

/** Läser kontakterna i tenanten (id-chunkar ≤ 40, § 21.8). Okända id:n släpps. */
async function loadTenantContacts(pb: PocketBase, actor: Actor, ids: readonly string[]): Promise<ContactGroupsRow[]> {
  const out: ContactGroupsRow[] = [];
  for (const part of chunk(ids, 40)) {
    const params: Record<string, string> = { tenant: actor.tenant };
    const ors = part.map((id, i) => {
      params[`id${i}`] = id;
      return `id = {:id${i}}`;
    });
    const filter = pb.filter(`tenant = {:tenant} && (${ors.join(' || ')})`, params);
    const read = (client: PocketBase) =>
      client.collection(CONTACTS).getFullList<ContactGroupsRow>({ filter, fields: 'id,tenant,groups', batch: 200 });
    let rows: ContactGroupsRow[] = [];
    try {
      rows = await read(pb);
    } catch {
      rows = [];
    }
    if (rows.length < part.length) {
      // PB v0.23.4 kan tyst neka listregeln (§ 21.8) — läs om med superuser;
      // tenant-filtret ovan är fortsatt gränsen.
      const su = await getSuperuserPb();
      if (su.ok) {
        try {
          rows = await read(su.pb);
        } catch {
          /* behåll det vi har */
        }
      }
    }
    out.push(...rows.filter((r) => String(r.tenant) === actor.tenant));
  }
  return out;
}

export interface GroupMembershipResult {
  groupName: string;
  changed: number;
  unchanged: number;
  notFound: number;
  overLimit: number;
  failed: number;
}

/** Lägger till eller tar bort kontakter ur en grupp (max 500 per anrop). */
export async function changeContactGroupMembers(
  pb: PocketBase,
  actor: Actor,
  groupId: string,
  change: { add?: readonly string[]; remove?: readonly string[] }
): Promise<WriteResult<GroupMembershipResult>> {
  const denied = guard(actor);
  if (denied) return denied as WriteResult<GroupMembershipResult>;
  const group = await loadGroup(pb, actor, groupId);
  if (!group) return fail('NOT_FOUND', 'Gruppen hittades inte i din organisation.');

  const add = [...new Set((change.add ?? []).filter(isContactGroupId))];
  const remove = [...new Set((change.remove ?? []).filter(isContactGroupId))];
  const ids = [...new Set([...add, ...remove])];
  if (ids.length === 0) return fail('INVALID_VALUE', 'Välj minst en kontakt.');
  if (ids.length > CONTACT_GROUP_MAX_BULK) {
    return fail('INVALID_VALUE', `Högst ${CONTACT_GROUP_MAX_BULK} kontakter åt gången.`);
  }

  const contacts = await loadTenantContacts(pb, actor, ids);
  const addSet = new Set(add);
  const result: GroupMembershipResult = {
    groupName: group.name,
    changed: 0,
    unchanged: 0,
    notFound: ids.length - contacts.length,
    overLimit: 0,
    failed: 0
  };
  let schemaMissing = false;

  await mapWithConcurrency(contacts, 4, async (c) => {
    const current = groupIdsOf(c.groups);
    const next = addSet.has(c.id)
      ? nextContactGroups(current, { add: [group.id] })
      : nextContactGroups(current, { remove: [group.id] });
    if (!next) {
      result.overLimit++;
      return;
    }
    if (sameIdSet(current, next)) {
      result.unchanged++;
      return;
    }
    try {
      const updated = await writeWithFallback(
        pb,
        (client) => client.collection(CONTACTS).update<Record<string, unknown>>(c.id, { groups: next }),
        { fallbackOn404: true }
      );
      if (!('groups' in updated)) schemaMissing = true;
      result.changed++;
    } catch {
      result.failed++;
    }
  });

  if (schemaMissing) return fail('DB_ERROR', CONTACT_GROUPS_MIGRATION_HINT);
  if (result.changed > 0) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: CONTACT_GROUPS,
      record_id: group.id,
      field: 'members',
      after_value: {
        name: group.name,
        ...(add.length ? { added: result.changed } : { removed: result.changed })
      }
    });
  }
  return ok(result);
}

/** Sätter exakt vilka grupper EN kontakt tillhör (kontaktkortet). */
export async function setContactGroups(
  pb: PocketBase,
  actor: Actor,
  contactId: string,
  groupIds: readonly string[]
): Promise<WriteResult<{ groupIds: string[] }>> {
  const denied = guard(actor);
  if (denied) return denied as WriteResult<{ groupIds: string[] }>;
  const contact = await getRecordInTenant<ContactGroupsRow & { first_name?: string; last_name?: string }>(
    pb,
    actor,
    CONTACTS,
    contactId.trim(),
    'id,tenant,groups,first_name,last_name'
  );
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte i din organisation.');

  const all = await listContactGroups(pb, actor.tenant);
  if (all.missing) return fail('DB_ERROR', CONTACT_GROUPS_MIGRATION_HINT);
  if (all.error) return fail('DB_ERROR', all.error);
  const known = new Set(all.groups.map((g) => g.id));
  const wanted = [...new Set(groupIds.filter((id) => known.has(id)))];
  if (wanted.length !== new Set(groupIds).size) return fail('INVALID_VALUE', 'En eller flera grupper finns inte.');
  const next = nextContactGroups([], { add: wanted });
  if (!next) return fail('INVALID_VALUE', 'För många grupper på en kontakt.');

  const current = groupIdsOf(contact.groups);
  if (sameIdSet(current, next)) return ok({ groupIds: next });
  try {
    const updated = await writeWithFallback(
      pb,
      (client) => client.collection(CONTACTS).update<Record<string, unknown>>(contact.id, { groups: next }),
      { fallbackOn404: true }
    );
    if (!('groups' in updated)) return fail('DB_ERROR', CONTACT_GROUPS_MIGRATION_HINT);
  } catch {
    return fail('DB_ERROR', 'Kunde inte spara kontaktens grupper.');
  }
  const names = new Map(all.groups.map((g) => [g.id, g.name]));
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CONTACTS,
    record_id: contact.id,
    field: 'groups',
    before_value: current.map((id) => names.get(id) ?? id),
    after_value: {
      value: next.map((id) => names.get(id) ?? id),
      name: contactDisplayName({ first_name: contact.first_name ?? '', last_name: contact.last_name ?? '' })
    }
  });
  return ok({ groupIds: next });
}
