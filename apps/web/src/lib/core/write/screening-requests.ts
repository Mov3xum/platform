import 'server-only';
import type PocketBase from 'pocketbase';
import {
  applyScreeningRequestAnswers,
  mergeScreeningRequestAnswersIntoFacts,
  normalizeScreeningFacts,
  normalizeScreeningRequestItems,
  screeningRequestStatusFor,
  summarizeScreeningFacts,
  validateScreeningRequestInput,
  type ScreeningRequestItem,
  type ScreeningRequestRecipient,
  type ScreeningRequestStatus
} from '@platform/shared';
import { notify, notifyStartupMembers } from '@/lib/notifications-server';
import { SCREENING_REQUESTS, mapScreeningRequestRow, type ScreeningRequestRow } from '@/lib/excellence/requests.server';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

// Begäran om komplettering (CLAUDE.md § 51.6) — det delade skrivlagret.
//
// Controllern (admin/incubator_lead/coach) skickar punkterna ur "Saknat
// underlag" till COACHEN eller till BOLAGET. Båda svarar direkt i systemet:
// svaren slås ihop till `startups.screening_facts` (EN sanning, § 51.4) och
// punkten markeras besvarad med en PII-fri etikett. En bolagsmedlem får
// svara BARA på en förfrågan ställd till bolaget och BARA på sitt eget
// länkade bolag — kontrollen görs här (klienten är aldrig gränsen), PB:s
// updateRule låser dessutom avsändar-/identitetsfälten för medlemmen.
// Skrivningen till `startups` går via superuser-fallback efter kontrollen
// (startups.updateRule är staff-only — § 21.3-mönstret). Agenten har inget
// verktyg för detta (människa-i-loopen).

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'];
const REQUEST_ROLES = ['admin', 'incubator_lead', 'coach'];

export interface AccessContext {
  /** Den inloggades länkade bolag (SessionUser.linkedStartups). */
  linkedStartups?: string[];
}

function isStaff(actor: Actor): boolean {
  return actor.roles.some((r) => STAFF_ROLES.includes(r));
}

function canAnswer(actor: Actor, row: ScreeningRequestRow, access: AccessContext): boolean {
  if (isStaff(actor)) return true;
  return (
    actor.roles.includes('startup_member') &&
    row.recipient_kind === 'startup' &&
    (access.linkedStartups ?? []).includes(row.startup)
  );
}

async function loadRequest(pb: PocketBase, actor: Actor, id: string): Promise<ScreeningRequestRow | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  const raw = await getRecordInTenant<{ id: string; tenant?: string }>(
    pb,
    actor,
    SCREENING_REQUESTS,
    id,
    'id,tenant,startup,screening,requested_by,recipient_kind,recipient,message,items,status,due_at,answered_at,closed_at,created,updated'
  );
  return raw ? mapScreeningRequestRow(raw as Parameters<typeof mapScreeningRequestRow>[0]) : null;
}

// ── Skapa ───────────────────────────────────────────────────────────────────

export interface CreateScreeningRequestInput {
  startupId: string;
  /** Körningen förfrågan utgår från (valfri). */
  screeningId?: string;
  recipient: unknown;
  /** Kollegan när mottagaren är coachen. */
  recipientUserId?: string;
  items: unknown;
  message?: unknown;
  dueDate?: unknown;
}

export interface CreatedScreeningRequest {
  id: string;
  recipient: ScreeningRequestRecipient;
  items: number;
  /** Icke-blockerande varningar (t.ex. notis som inte gick fram). */
  warnings: string[];
}

export async function createScreeningRequest(
  pb: PocketBase,
  actor: Actor,
  input: CreateScreeningRequestInput
): Promise<WriteResult<CreatedScreeningRequest>> {
  const policy = canCreateRecord(actor, SCREENING_REQUESTS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
  if (!actor.roles.some((r) => REQUEST_ROLES.includes(r))) {
    return fail('FORBIDDEN', 'Bara admin, inkubatorledning och coach kan skicka en begäran om komplettering.');
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.startupId)) return fail('INVALID_VALUE', 'Ogiltigt bolag.');
  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, 'startups', input.startupId, 'id,tenant,name');
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const v = validateScreeningRequestInput({ recipient: input.recipient, items: input.items, message: input.message, dueDate: input.dueDate });
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  let recipientUserId: string | undefined;
  if (v.value.recipient === 'coach') {
    const rid = (input.recipientUserId ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(rid)) return fail('INVALID_VALUE', 'Välj vilken kollega förfrågan ska gå till.');
    // Mottagaren måste vara Movexum-personal i samma tenant (aldrig en bolagsmedlem).
    const u = await getRecordInTenant<{ id: string; tenant?: string; roles?: string[] }>(pb, actor, 'users', rid, 'id,tenant,roles');
    if (!u || !(u.roles ?? []).some((r) => STAFF_ROLES.includes(r))) return fail('INVALID_VALUE', 'Mottagaren måste vara Movexum-personal i din organisation.');
    recipientUserId = u.id;
  }
  let screeningId: string | undefined;
  if (input.screeningId && /^[a-zA-Z0-9_-]{1,64}$/.test(input.screeningId)) {
    const run = await getRecordInTenant<{ id: string; tenant?: string; startup?: string }>(pb, actor, 'startup_screenings', input.screeningId, 'id,tenant,startup');
    if (run && run.startup === startup.id) screeningId = run.id;
  }

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    startup: startup.id,
    requested_by: actor.id,
    recipient_kind: v.value.recipient,
    items: v.value.items,
    status: 'open' satisfies ScreeningRequestStatus
  };
  if (screeningId) payload.screening = screeningId;
  if (recipientUserId) payload.recipient = recipientUserId;
  if (v.value.message) payload.message = v.value.message;
  if (v.value.dueDate) payload.due_at = `${v.value.dueDate} 00:00:00`;

  let rec: { id: string; items?: unknown };
  try {
    rec = await writeWithFallback(pb, (c) => c.collection(SCREENING_REQUESTS).create<{ id: string; items?: unknown }>(payload, { fields: 'id,items' }));
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    return fail('DB_ERROR', status === 404 ? 'Kollektionen screening_requests saknas — kör migration 1700000191.' : 'Förfrågan kunde inte sparas.');
  }

  // Audit — PII-fritt: bolag, mottagartyp, antal punkter (aldrig texten).
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: SCREENING_REQUESTS,
    record_id: rec.id,
    after_value: { startup: startup.id, startup_name: startup.name, recipient_kind: v.value.recipient, items: v.value.items.length, has_message: !!v.value.message }
  });

  const warnings: string[] = [];
  const href = `/komplettering/${rec.id}`;
  const title = `Komplettering inför statsstödsbedömning: ${startup.name ?? 'bolaget'}`;
  const snippet = `${v.value.items.length} ${v.value.items.length === 1 ? 'punkt' : 'punkter'} att besvara${v.value.dueDate ? ` senast ${v.value.dueDate}` : ''}.`;
  try {
    const res =
      v.value.recipient === 'coach' && recipientUserId
        ? await (async () => {
            await notify(pb, {
              tenant: actor.tenant,
              recipients: [recipientUserId],
              kind: 'screening_request',
              actorId: actor.id,
              entity: { type: 'screening_request', id: rec.id },
              payload: { title, snippet, href }
            });
            return { delivered: 1 };
          })()
        : await notifyStartupMembers(pb, {
            tenant: actor.tenant,
            startupId: startup.id,
            kind: 'screening_request',
            actorId: actor.id,
            entity: { type: 'screening_request', id: rec.id },
            payload: { title, snippet, href }
          });
    if (v.value.recipient === 'startup' && res.delivered === 0) {
      warnings.push('Bolaget har ingen inloggad medlem i plattformen — skicka checklistan som text i stället.');
    }
  } catch {
    warnings.push('Notisen kunde inte skickas.');
  }

  return ok({ id: rec.id, recipient: v.value.recipient, items: v.value.items.length, warnings });
}

// ── Svara ───────────────────────────────────────────────────────────────────

export interface AnswerScreeningRequestInput {
  requestId: string;
  /** Svar per punkt-nyckel (råa ur klienten; normaliseras per kind). */
  answers: unknown;
}

export interface AnsweredScreeningRequest {
  id: string;
  status: ScreeningRequestStatus;
  answered: number;
  total: number;
  rejected: string[];
  factsSaved: boolean;
  factsSchemaMissing: boolean;
  warnings: string[];
}

export async function answerScreeningRequest(
  pb: PocketBase,
  actor: Actor,
  input: AnswerScreeningRequestInput,
  access: AccessContext = {}
): Promise<WriteResult<AnsweredScreeningRequest>> {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Kompletteringar besvaras av en människa, inte av agenten.');
  const row = await loadRequest(pb, actor, input.requestId);
  if (!row) return fail('NOT_FOUND', 'Förfrågan hittades inte.');
  if (!canAnswer(actor, row, access)) return fail('FORBIDDEN', 'Du kan inte besvara den här förfrågan.');
  if (row.status === 'closed') return fail('STATE_TRANSITION', 'Förfrågan är avslutad.');
  if (typeof input.answers !== 'object' || input.answers === null || Array.isArray(input.answers)) {
    return fail('INVALID_VALUE', 'Svaren kunde inte läsas.');
  }

  const now = new Date().toISOString();
  const applied = applyScreeningRequestAnswers(row.items, { answers: input.answers as Record<string, unknown>, answeredAt: now, answeredBy: actor.id });
  if (applied.answeredKeys.length === 0 && applied.rejectedKeys.length > 0) {
    return fail('INVALID_VALUE', 'Inget av svaren kunde tolkas — kontrollera värdena.');
  }
  const nextStatus = screeningRequestStatusFor(applied.items);

  // 1) Svaren in i bolagets manuella svar (EN sanning) — bara de punkter som
  //    fick svar nu, så ett äldre svar aldrig skriver över ett nyare.
  let factsSaved = false;
  let factsSchemaMissing = false;
  if (applied.answeredKeys.length > 0) {
    const current = await getRecordInTenant<{ id: string; tenant?: string; screening_facts?: unknown }>(pb, actor, 'startups', row.startup, 'id,tenant,screening_facts');
    if (!current) return fail('NOT_FOUND', 'Bolaget hittades inte.');
    const before = normalizeScreeningFacts(current.screening_facts);
    const merged = mergeScreeningRequestAnswersIntoFacts(before, applied.items, applied.answeredKeys);
    try {
      const after = await writeWithFallback(pb, (c) =>
        c.collection('startups').update<{ screening_facts?: unknown }>(row.startup, { screening_facts: merged }, { fields: 'id,screening_facts' })
      );
      factsSaved = true;
      factsSchemaMissing = after.screening_facts === undefined || after.screening_facts === null;
    } catch {
      return fail('DB_ERROR', 'Svaren kunde inte sparas på bolagskortet.');
    }
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: 'startups',
      record_id: row.startup,
      field: 'screening_facts',
      before_value: summarizeScreeningFacts(before),
      after_value: { ...summarizeScreeningFacts(merged), via_request: row.id, schema_missing: factsSchemaMissing }
    });
  }

  // 2) Förfrågan: punkterna + status. En medlem får PATCH:a bara items/
  //    status/answered_at (updateRule låser resten) — payloaden håller sig till det.
  const payload: Record<string, unknown> = { items: applied.items, status: nextStatus };
  if (nextStatus === 'answered') payload.answered_at = now;
  try {
    await writeWithFallback(pb, (c) => c.collection(SCREENING_REQUESTS).update(row.id, payload, { fields: 'id' }), { fallbackOn404: true });
  } catch {
    return fail('DB_ERROR', 'Förfrågan kunde inte uppdateras (svaren är sparade på bolagskortet).');
  }

  const answered = applied.items.filter((i) => i.status === 'answered').length;
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SCREENING_REQUESTS,
    record_id: row.id,
    field: 'items',
    after_value: { startup: row.startup, startup_name: row.startup_name, status: nextStatus, answered, items: applied.items.length, recipient_kind: row.recipient_kind }
  });

  const warnings: string[] = [];
  if (applied.answeredKeys.length > 0 && row.requested_by && row.requested_by !== actor.id) {
    try {
      await notify(pb, {
        tenant: actor.tenant,
        recipients: [row.requested_by],
        kind: 'screening_answered',
        actorId: actor.id,
        entity: { type: 'screening_request', id: row.id },
        payload: {
          title: `Komplettering besvarad: ${row.startup_name ?? 'bolaget'}`,
          snippet: `${answered} av ${applied.items.length} punkter besvarade${nextStatus === 'answered' ? ' — allt är inne.' : '.'}`,
          href: `/komplettering/${row.id}`
        }
      });
    } catch {
      warnings.push('Notisen till avsändaren kunde inte skickas.');
    }
  }

  return ok({ id: row.id, status: nextStatus, answered, total: applied.items.length, rejected: applied.rejectedKeys, factsSaved, factsSchemaMissing, warnings });
}

// ── Avsluta ─────────────────────────────────────────────────────────────────

export async function closeScreeningRequest(pb: PocketBase, actor: Actor, requestId: string): Promise<WriteResult<{ id: string }>> {
  if (!actor.roles.some((r) => REQUEST_ROLES.includes(r))) return fail('FORBIDDEN', 'Bara admin, inkubatorledning och coach kan avsluta en förfrågan.');
  const row = await loadRequest(pb, actor, requestId);
  if (!row) return fail('NOT_FOUND', 'Förfrågan hittades inte.');
  if (row.status === 'closed') return ok({ id: row.id });
  const now = new Date().toISOString();
  try {
    await writeWithFallback(pb, (c) => c.collection(SCREENING_REQUESTS).update(row.id, { status: 'closed', closed_by: actor.id, closed_at: now }, { fields: 'id' }), {
      fallbackOn404: true
    });
  } catch {
    return fail('DB_ERROR', 'Förfrågan kunde inte avslutas.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SCREENING_REQUESTS,
    record_id: row.id,
    field: 'status',
    before_value: row.status,
    after_value: { startup: row.startup, startup_name: row.startup_name, closed: true }
  });
  return ok({ id: row.id });
}

/** Punkterna i en förfrågan som de ser ut nu (för formuläret). */
export function requestItemsOf(row: ScreeningRequestRow): ScreeningRequestItem[] {
  return normalizeScreeningRequestItems(row.items);
}
