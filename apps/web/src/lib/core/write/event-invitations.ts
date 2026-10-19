import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { canRemoveInvitation } from '@platform/shared';
import { recomputeEventCounters } from '@/lib/events/counters';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Inbjudningar till event (CLAUDE.md § 53.5 / § 54) — det som är kvar i
 * skrivlagret efter konsolideringen 2026-10: svarstoken (hash + generering)
 * och borttagning av en inbjudan. Själva inbjudandet, påminnelser och
 * uppföljning är KAMPANJER (`lib/email/campaign-dispatch.ts`): en inbjudan
 * är en rad i deltagarlistan (`event_signups`, stage `invited`) med
 * `contact`/`user`/`startup`, skapad av kampanjmotorn när ett utskick med
 * svarsknappar går ut. Svarslänkens token genereras vid varje utskick,
 * lagras bara som SHA-256-hash och finns i klartext enbart i mejlet — ett
 * nytt utskick roterar den. Bara människor bjuder in
 * (`CREATE_POLICIES.event_signups`: agent nekad).
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function hashRsvpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRsvpToken(): string {
  return randomBytes(32).toString('base64url');
}

function gate(actor: Actor): WriteResult<never> | null {
  const policy = canCreateRecord(actor, 'event_signups');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Saknar behörighet.');
  return null;
}

/**
 * Tar bort en inbjudan (raden i deltagarlistan). Svarslänken slutar gälla
 * eftersom hashen försvinner med raden. Bara inbjudna, avböjda och ja-svar
 * utan markerad närvaro (`canRemoveInvitation`) — närvaro är ett utfall som
 * mål och utvärderingar räknar på. Auditen bär eventets namn och steget,
 * aldrig mottagaren.
 */
export async function removeEventInvitation(
  pb: PocketBase,
  actor: Actor,
  signupId: string
): Promise<WriteResult<{ eventId: string }>> {
  const denied = gate(actor);
  if (denied) return denied;
  if (!ID.test(signupId)) return fail('INVALID_VALUE', 'Ogiltig inbjudan.');
  const row = await getRecordInTenant<{ id: string; tenant?: string; event?: string; stage?: string; invited_at?: string }>(
    pb,
    actor,
    'event_signups',
    signupId,
    'id,tenant,event,stage,invited_at'
  );
  if (!row || !row.event) return fail('NOT_FOUND', 'Inbjudan hittades inte.');
  if (!canRemoveInvitation(row)) {
    return fail(
      'STATE_TRANSITION',
      row.invited_at
        ? 'Personen är markerad som närvarande — ändra eller ta bort raden i eventets deltagarlista.'
        : 'Raden är ingen inbjudan — ta bort den i eventets deltagarlista.'
    );
  }
  const ev = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, 'incubator_events', row.event, 'id,tenant,name');
  try {
    await writeWithFallback(pb, (c) => c.collection('event_signups').delete(row.id), { fallbackOn404: true });
  } catch (err) {
    console.error('[invitations] remove failed', { status: (err as { status?: number })?.status });
    return fail('DB_ERROR', 'Inbjudan kunde inte tas bort. Försök igen.');
  }
  await recomputeEventCounters(pb, actor.tenant, row.event);
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'event_signups',
    record_id: row.event,
    field: 'invitation_removed',
    after_value: { title: ev?.name ?? '', stage: row.stage ?? '', deleted: true }
  });
  return ok({ eventId: row.event });
}
