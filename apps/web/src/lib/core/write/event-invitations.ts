import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  INVITE_MAX_RECIPIENTS,
  formatStockholmDateTime,
  rsvpOpen,
  selectInviteRecipients
} from '@platform/shared';
import { sendEventInvites } from '@/lib/email';
import { recomputeEventCounters } from '@/lib/events/counters';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Inbjudningar till event (CLAUDE.md § 53.5) via det delade skrivlagret.
 *
 * En inbjudan är en rad i deltagarlistan (`event_signups`, stage
 * `invited`, `contact` = kontakten i kontaktboken). Svarslänkens token
 * genereras vid varje utskick, lagras bara som SHA-256-hash och finns i
 * klartext enbart i mejlet — ett nytt utskick (påminnelse) roterar den.
 *
 * - Bara människor bjuder in (`CREATE_POLICIES.event_signups`: agent nekad).
 * - Kontakterna slås upp med användarens token, tenant-filtrerat; den som
 *   avregistrerat sig (`invite_opt_out`) hoppas över vid VARJE utskick.
 * - E-postadresserna kopieras till deltagarraden (samma som en manuellt
 *   inlagd deltagare) och loggas aldrig; auditen innehåller bara antal.
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MIGRATION_HINT = 'PocketBase saknar fälten för inbjudningar — kör migration 1700000197 (eller "Sync PocketBase").';

export function hashRsvpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRsvpToken(): string {
  return randomBytes(32).toString('base64url');
}

type EventRow = { id: string; tenant?: string; name?: string; starts_at?: string; ends_at?: string; location?: string; description?: string };

async function loadOpenEvent(pb: PocketBase, actor: Actor, eventId: string): Promise<EventRow | { error: WriteResult<never> }> {
  if (!ID.test(eventId)) return { error: fail('INVALID_VALUE', 'Ogiltigt event.') };
  const ev = await getRecordInTenant<EventRow>(pb, actor, 'incubator_events', eventId, 'id,tenant,name,starts_at,ends_at,location,description');
  if (!ev) return { error: fail('NOT_FOUND', 'Eventet hittades inte.') };
  if (!rsvpOpen(ev, new Date(), 'yes')) {
    return { error: fail('STATE_TRANSITION', 'Eventet har redan ägt rum — inbjudningar kan inte skickas.') };
  }
  return ev;
}

function gate(actor: Actor): WriteResult<never> | null {
  const policy = canCreateRecord(actor, 'event_signups');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Saknar behörighet.');
  return null;
}

function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

type ContactRow = { id: string; first_name?: string; last_name?: string; email?: string; organization?: string; invite_opt_out?: boolean };

async function loadContacts(pb: PocketBase, tenant: string, ids: readonly string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    out.push(
      ...(await pb.collection('contacts').getFullList<ContactRow>({
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'id', part)}`,
        fields: 'id,first_name,last_name,email,organization,invite_opt_out'
      }))
    );
  }
  return out;
}

export interface InviteResult {
  invited: number;
  sent: number;
  failed: number;
  skipped: { optOut: number; noEmail: number; already: number; overCap: number };
}

/**
 * Lägger till kontakter som inbjudna och skickar inbjudan direkt. Kontakter
 * som redan finns på listan, saknar e-post eller avregistrerat sig hoppas
 * över (räknas i svaret).
 */
export async function inviteContactsToEvent(
  pb: PocketBase,
  actor: Actor,
  input: { eventId: string; contactIds: unknown; baseUrl: string }
): Promise<WriteResult<InviteResult>> {
  const denied = gate(actor);
  if (denied) return denied;
  const ev = await loadOpenEvent(pb, actor, input.eventId);
  if ('error' in ev) return ev.error;

  const ids = [...new Set((Array.isArray(input.contactIds) ? input.contactIds : []).map((v) => String(v ?? '')))];
  if (ids.length === 0) return fail('INVALID_VALUE', 'Välj minst en kontakt.');
  if (ids.length > INVITE_MAX_RECIPIENTS || ids.some((v) => !ID.test(v))) {
    return fail('INVALID_VALUE', `Välj högst ${INVITE_MAX_RECIPIENTS} giltiga kontakter.`);
  }

  let contacts: ContactRow[];
  let existing: { contact?: string; email?: string }[];
  try {
    contacts = await loadContacts(pb, actor.tenant, ids);
    existing = await pb.collection('event_signups').getFullList<{ contact?: string; email?: string }>({
      filter: pb.filter('tenant = {:t} && event = {:e}', { t: actor.tenant, e: ev.id }),
      fields: 'id,contact,email'
    });
  } catch {
    return fail('DB_ERROR', 'Kunde inte läsa kontakterna eller deltagarlistan.');
  }
  const { invite, skipped } = selectInviteRecipients(contacts, existing);

  const now = new Date().toISOString();
  let invited = 0;
  for (const c of invite) {
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || 'Kontakt';
    try {
      const row = await writeWithFallback(pb, (client) =>
        client.collection('event_signups').create<Record<string, unknown>>({
          tenant: actor.tenant,
          event: ev.id,
          name: name.slice(0, 200),
          email: (c.email || '').trim().toLowerCase(),
          organization: (c.organization || '').slice(0, 200),
          stage: 'invited',
          contact: c.id,
          invited_at: now
        })
      );
      // PB släpper okända fält tyst (§ 24.4) — utan kontaktrelationen kan
      // avregistreringen aldrig nå kontakten.
      if (!('invited_at' in row)) return fail('DB_ERROR', MIGRATION_HINT);
      invited++;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 400) return fail('DB_ERROR', MIGRATION_HINT);
      console.error('[invitations] create failed', { status });
    }
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'event_signups',
    record_id: ev.id,
    field: 'invitations',
    after_value: { title: ev.name ?? '', invited, skipped }
  });

  const sent = await sendEventInvitations(pb, actor, { eventId: ev.id, mode: 'pending', baseUrl: input.baseUrl });
  if (!sent.ok) return sent;
  return ok({ invited, sent: sent.value.sent, failed: sent.value.failed, skipped });
}

export interface SendInvitationsResult {
  sent: number;
  failed: number;
  optedOut: number;
}

/**
 * Skickar (eller påminner) inbjudna som inte svarat. `pending` = bara rader
 * som aldrig fått ett mejl; `reminder` = alla som fortfarande står som
 * inbjudna. Varje utskick roterar svarstoken.
 */
export async function sendEventInvitations(
  pb: PocketBase,
  actor: Actor,
  input: { eventId: string; mode: 'pending' | 'reminder'; baseUrl: string }
): Promise<WriteResult<SendInvitationsResult>> {
  const denied = gate(actor);
  if (denied) return denied;
  const ev = await loadOpenEvent(pb, actor, input.eventId);
  if ('error' in ev) return ev.error;
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) return fail('INVALID_VALUE', 'Ingen giltig adress för svarslänken.');

  type Row = { id: string; email?: string; contact?: string; invite_sent_at?: string };
  let rows: Row[];
  try {
    rows = await pb.collection('event_signups').getFullList<Row>({
      filter: pb.filter('tenant = {:t} && event = {:e} && stage = "invited"', { t: actor.tenant, e: ev.id }),
      fields: 'id,email,contact,invite_sent_at'
    });
  } catch {
    return fail('DB_ERROR', 'Kunde inte läsa deltagarlistan.');
  }
  if (input.mode === 'pending') rows = rows.filter((r) => !r.invite_sent_at);
  rows = rows.slice(0, INVITE_MAX_RECIPIENTS);

  // Avregistrering gäller vid varje utskick, även för redan inbjudna.
  const contactIds = [...new Set(rows.map((r) => r.contact).filter((v): v is string => Boolean(v)))];
  let optedOutIds = new Set<string>();
  if (contactIds.length > 0) {
    try {
      const contacts = await loadContacts(pb, actor.tenant, contactIds);
      optedOutIds = new Set(contacts.filter((c) => c.invite_opt_out === true).map((c) => c.id));
    } catch {
      return fail('DB_ERROR', 'Kunde inte kontrollera avregistreringar — inget skickades.');
    }
  }
  const sendable = rows.filter((r) => r.email && !(r.contact && optedOutIds.has(r.contact)));

  const recipients: { key: string; email: string; rsvpUrl: string }[] = [];
  for (const r of sendable) {
    const token = newRsvpToken();
    try {
      await writeWithFallback(pb, (c) => c.collection('event_signups').update(r.id, { rsvp_token_hash: hashRsvpToken(token) }));
    } catch {
      continue; // utan sparad hash vore länken död — skicka inte
    }
    recipients.push({ key: r.id, email: r.email as string, rsvpUrl: `${baseUrl}/e/svar?t=${token}` });
  }

  const startsAt = ev.starts_at ? formatStockholmDateTime(ev.starts_at) : '';
  const { sent, failed } = await sendEventInvites(recipients, {
    eventName: ev.name || 'Event',
    when: startsAt || 'Tid meddelas',
    location: ev.location || undefined,
    intro: ev.description ? ev.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) : undefined,
    reminder: input.mode === 'reminder'
  });
  const sentAt = new Date().toISOString();
  for (const id of sent) {
    await writeWithFallback(pb, (c) => c.collection('event_signups').update(id, { invite_sent_at: sentAt })).catch(() => undefined);
  }
  await recomputeEventCounters(pb, actor.tenant, ev.id);

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'event_signups',
    record_id: ev.id,
    field: input.mode === 'reminder' ? 'invitation_reminder' : 'invitation_sent',
    after_value: { title: ev.name ?? '', sent: sent.length, failed, opted_out: rows.length - sendable.length }
  });
  return ok({ sent: sent.length, failed, optedOut: rows.length - sendable.length });
}
