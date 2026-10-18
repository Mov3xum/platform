import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  INVITE_MAX_RECIPIENTS,
  formatStockholmDateTime,
  inviteReason,
  rsvpOpen,
  selectInviteRecipients,
  type InviteCandidate,
  type InviteSkipped
} from '@platform/shared';
import { EMAIL_NOT_CONFIGURED_MESSAGE, isEmailConfigured, sendEventInvites, type EventInviteRecipient } from '@/lib/email';
import { recomputeEventCounters } from '@/lib/events/counters';
import {
  contactDisplayName,
  loadContactsByIds,
  loadInviteUsers,
  loadStartupReach,
  type ContactRow
} from '@/lib/events/invite-candidates';
import { signUnsubscribeKey, unsubscribeSecret } from '@/lib/unsubscribe-key';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Inbjudningar till event (CLAUDE.md § 53.5) via det delade skrivlagret.
 *
 * En inbjudan är en rad i deltagarlistan (`event_signups`, stage
 * `invited`) med `contact` (kontaktboken), `user` (bolagsmedlem eller
 * Movexum-personal) och/eller
 * `startup` (bolaget den bjöds in via). Svarslänkens token
 * genereras vid varje utskick, lagras bara som SHA-256-hash och finns i
 * klartext enbart i mejlet — ett nytt utskick (påminnelse) roterar den.
 *
 * - Bara människor bjuder in (`CREATE_POLICIES.event_signups`: agent nekad).
 * - Kontakter och bolag slås upp med användarens token, tenant-filtrerat;
 *   bolagsmedlemmarnas e-post läses via superusern EFTER rollkontrollen
 *   (`lib/events/invite-candidates.ts`). En kontakt som avregistrerat sig
 *   (`invite_opt_out`) hoppas över vid VARJE utskick.
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

export interface InviteResult {
  invited: number;
  sent: number;
  failed: number;
  skipped: InviteSkipped;
  /** Bolag som saknar både medlemmar, huvudkontakter och e-post. */
  unreachableStartups: number;
  /** Raderna skapades men utskicket gick inte — orsaken (PII-fri). */
  sendError?: string;
}

const MAX_STARTUPS = 200;

type Candidate = InviteCandidate & {
  name: string;
  organization: string;
  contact?: string;
  user?: string;
  startup?: string;
};

function contactCandidate(c: ContactRow, startup?: string, organization?: string): Candidate {
  return {
    id: c.id,
    kind: 'contact',
    email: c.email,
    invite_opt_out: c.invite_opt_out,
    name: contactDisplayName(c),
    organization: organization || c.organization || '',
    contact: c.id,
    ...(startup ? { startup } : {})
  };
}

function idList(raw: unknown, max: number): string[] | null {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((v) => String(v ?? '')))].filter(Boolean);
  if (ids.length > max || ids.some((v) => !ID.test(v))) return null;
  return ids;
}

/**
 * Lägger till kontakter och/eller bolag som inbjudna och skickar inbjudan
 * direkt. Ett bolag blir en rad per mottagare (medlemmar, annars
 * huvudkontakter, annars bolagets adress). Mottagare som redan finns på
 * listan, saknar e-post eller avregistrerat sig hoppas över (räknas i svaret).
 */
export async function inviteToEvent(
  pb: PocketBase,
  actor: Actor,
  input: { eventId: string; contactIds?: unknown; userIds?: unknown; startupIds?: unknown; baseUrl: string }
): Promise<WriteResult<InviteResult>> {
  const denied = gate(actor);
  if (denied) return denied;
  // Utan e-posttjänst kan ingen inbjudan nå fram — stoppa innan något skrivs.
  if (!isEmailConfigured()) return fail('STATE_TRANSITION', EMAIL_NOT_CONFIGURED_MESSAGE);
  const ev = await loadOpenEvent(pb, actor, input.eventId);
  if ('error' in ev) return ev.error;

  const contactIds = idList(input.contactIds, INVITE_MAX_RECIPIENTS);
  const userIds = idList(input.userIds, INVITE_MAX_RECIPIENTS);
  const startupIds = idList(input.startupIds, MAX_STARTUPS);
  if (!contactIds || !userIds || !startupIds) {
    return fail('INVALID_VALUE', `Välj högst ${INVITE_MAX_RECIPIENTS} personer och ${MAX_STARTUPS} bolag.`);
  }
  if (contactIds.length === 0 && userIds.length === 0 && startupIds.length === 0) {
    return fail('INVALID_VALUE', 'Välj minst en mottagare.');
  }

  const candidates: Candidate[] = [];
  let unreachableStartups = 0;
  let existing: { contact?: string; user?: string; email?: string }[];
  try {
    if (contactIds.length > 0) {
      for (const c of await loadContactsByIds(pb, actor.tenant, contactIds)) candidates.push(contactCandidate(c));
    }
    if (userIds.length > 0) {
      // Bara personal och rena bolagsmedlemmar i tenanten (loadInviteUsers
      // filtrerar på roll och tenant); övriga id:n släpps tyst.
      for (const u of await loadInviteUsers(pb, actor.tenant, { ids: userIds })) {
        candidates.push({
          id: u.id,
          kind: 'user',
          email: u.email,
          name: u.name,
          organization: u.kind === 'staff' ? 'Movexum' : u.startupName,
          user: u.id,
          ...(u.startup ? { startup: u.startup } : {})
        });
      }
    }
    if (startupIds.length > 0) {
      for (const reach of await loadStartupReach(pb, actor.tenant, startupIds)) {
        if (reach.members.length > 0) {
          for (const m of reach.members) {
            candidates.push({ id: m.id, kind: 'user', email: m.email, name: m.name, organization: reach.name, user: m.id, startup: reach.id });
          }
        } else if (reach.primaryContacts.length > 0) {
          for (const c of reach.primaryContacts) candidates.push(contactCandidate(c, reach.id, reach.name));
        } else if (reach.companyEmail) {
          candidates.push({ id: reach.id, kind: 'startup', email: reach.companyEmail, name: reach.name, organization: reach.name, startup: reach.id });
        } else {
          unreachableStartups++;
        }
      }
    }
    existing = await pb.collection('event_signups').getFullList<{ contact?: string; user?: string; email?: string }>({
      filter: pb.filter('tenant = {:t} && event = {:e}', { t: actor.tenant, e: ev.id }),
      fields: 'id,contact,user,email'
    });
  } catch (err) {
    const msg = err instanceof Error && err.message.includes('superuser') ? err.message : 'Kunde inte läsa mottagarna eller deltagarlistan.';
    return fail('DB_ERROR', msg);
  }
  const { invite, skipped } = selectInviteRecipients(candidates, existing);

  const now = new Date().toISOString();
  let invited = 0;
  for (const c of invite) {
    try {
      const row = await writeWithFallback(pb, (client) =>
        client.collection('event_signups').create<Record<string, unknown>>({
          tenant: actor.tenant,
          event: ev.id,
          name: (c.name || c.email || 'Inbjuden').slice(0, 200),
          email: (c.email || '').trim().toLowerCase(),
          organization: c.organization.slice(0, 200),
          stage: 'invited',
          invited_at: now,
          ...(c.contact ? { contact: c.contact } : {}),
          ...(c.user ? { user: c.user } : {}),
          ...(c.startup ? { startup: c.startup } : {})
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
    after_value: { title: ev.name ?? '', invited, users: userIds.length, startups: startupIds.length, skipped }
  });

  // Raderna finns nu — ett misslyckat utskick redovisas, det rullar inte
  // tillbaka listan ("Skicka ej utskickade" tar dem senare).
  const sent = await sendEventInvitations(pb, actor, { eventId: ev.id, mode: 'pending', baseUrl: input.baseUrl });
  if (!sent.ok) return ok({ invited, sent: 0, failed: 0, skipped, unreachableStartups, sendError: sent.error });
  return ok({ invited, sent: sent.value.sent, failed: sent.value.failed, skipped, unreachableStartups });
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
  if (!isEmailConfigured()) return fail('STATE_TRANSITION', EMAIL_NOT_CONFIGURED_MESSAGE);
  const ev = await loadOpenEvent(pb, actor, input.eventId);
  if ('error' in ev) return ev.error;
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) return fail('INVALID_VALUE', 'Ingen giltig adress för svarslänken.');

  type Row = { id: string; email?: string; contact?: string; user?: string; startup?: string; invite_sent_at?: string };
  let rows: Row[];
  try {
    rows = await pb.collection('event_signups').getFullList<Row>({
      filter: pb.filter('tenant = {:t} && event = {:e} && stage = "invited"', { t: actor.tenant, e: ev.id }),
      fields: 'id,email,contact,user,startup,invite_sent_at'
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
      const contacts = await loadContactsByIds(pb, actor.tenant, contactIds);
      optedOutIds = new Set(contacts.filter((c) => c.invite_opt_out === true).map((c) => c.id));
    } catch {
      return fail('DB_ERROR', 'Kunde inte kontrollera avregistreringar — inget skickades.');
    }
  }
  const sendable = rows.filter((r) => r.email && !(r.contact && optedOutIds.has(r.contact)));

  const secret = unsubscribeSecret();
  const recipients: EventInviteRecipient[] = [];
  for (const r of sendable) {
    const token = newRsvpToken();
    try {
      await writeWithFallback(pb, (c) => c.collection('event_signups').update(r.id, { rsvp_token_hash: hashRsvpToken(token) }));
    } catch {
      continue; // utan sparad hash vore länken död — skicka inte
    }
    // Kontaktnätet (berättigat intresse) får avregistrering med en stabil
    // nyckel som fungerar från varje mejl; bolagsmedlemmar och bolagets egen
    // adress bjuds in som del av programmet, personalen som medarbetare.
    const key = r.contact ? signUnsubscribeKey(r.contact, secret) : null;
    recipients.push({
      key: r.id,
      email: r.email as string,
      rsvpUrl: `${baseUrl}/e/svar?t=${token}`,
      reason: inviteReason(r),
      unsubscribeUrl: key ? `${baseUrl}/e/avregistrera?k=${key}` : null,
      oneClickUrl: key ? `${baseUrl}/api/public/e/unsubscribe?k=${key}` : null
    });
  }

  const startsAt = ev.starts_at ? formatStockholmDateTime(ev.starts_at) : '';
  let sent: string[];
  let failed: number;
  try {
    ({ sent, failed } = await sendEventInvites(recipients, {
      eventName: ev.name || 'Event',
      when: startsAt || 'Tid meddelas',
      location: ev.location || undefined,
      intro: ev.description ? ev.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) : undefined,
      reminder: input.mode === 'reminder'
    }));
  } catch (err) {
    console.error('[invitations] send failed', err instanceof Error ? err.message : 'unknown');
    return fail('DB_ERROR', 'Inbjudningarna kunde inte skickas. Försök igen med "Skicka ej utskickade".');
  }
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
