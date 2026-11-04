'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser, type SessionUser } from '@/lib/auth.server';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { FEEDBACK_ITEMS, getFeedbackItem, type FeedbackItem } from '@/lib/feedback/data';
import { feedbackAreasForUser } from '@/lib/feedback/areas';
import { listStaffUsers } from '@/lib/contacts/data';
import { notify } from '@/lib/notifications-server';
import {
  FEEDBACK_STATUS_LABELS,
  canCreateFeedback,
  canDeleteFeedback,
  canEditFeedback,
  canRespondToFeedback,
  canTestFeedback,
  feedbackAreaLabel,
  isFeedbackStatus,
  statusAfterFeedbackTest,
  testerAfterStatusChange,
  validateFeedbackAnswer,
  validateFeedbackInput,
  validateFeedbackTest,
  type FeedbackStatus
} from '@platform/shared';

/**
 * Önskemål & buggar (CLAUDE.md § 49) — server actions.
 *
 * RBAC: lägga upp kort = Movexum-personal (`FEEDBACK_AUTHOR_ROLES`);
 * redigera = författaren (tills kortet är klart) eller ledningen; svara,
 * flytta i flödet (Öppen → Påbörjad → Väntar återkoppling → Klar), peka ut
 * testare och återöppna = ledningen (`FEEDBACK_RESPONDER_ROLES`,
 * admin/incubator_lead); återkoppla på ett test = den utpekade testaren
 * eller ledningen (`canTestFeedback`). Rollen enforce:as HÄR (PB:s createRule är roll-lös
 * per § 21.3); tenant + author stämplas alltid server-side från den
 * inloggade — aldrig från klienten. Skrivningar går via användarens token
 * med superuser-fallback ENBART vid PB v0.23.4:s tysta regel-nekande
 * (400/403/404), efter verifierad roll + tenant (§ 18.3/§ 20.5-mönstret).
 * All fritext personnummer-saneras (§ 15.6). Varje mutation audit-loggas i
 * `agent_actions` (PII-fritt: rubrik/typ/område/status — aldrig
 * beskrivning eller svar, bara längd) så den syns i den samlade loggen
 * (§ 32). Riskklass n/a — ingen AI-inferens.
 */

export interface FeedbackActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

function revalidate() {
  revalidatePath('/onskemal');
}

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

async function requireSession(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  const pb = await getServerPb();
  return { user, pb };
}

async function superuser(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[feedback] superuser unavailable — ingen fallback', { reason: su.reason });
    return null;
  }
  return su.pb;
}

function isRuleDenial(err: unknown): boolean {
  const status = pbStatus(err);
  return status === 400 || status === 403 || status === 404;
}

/** Skriv via användartoken; superuser bara vid tyst regel-nekande (roll redan verifierad). */
async function write<T>(pb: PocketBase, run: (client: PocketBase) => Promise<T>, fallback: string): Promise<T | { error: string }> {
  try {
    return await run(pb);
  } catch (err) {
    if (!isRuleDenial(err)) return { error: describePbError(err, fallback) };
    const su = await superuser();
    if (!su) return { error: describePbError(err, fallback) };
    try {
      return await run(su);
    } catch (err2) {
      return { error: describePbError(err2, fallback) };
    }
  }
}

function isErr(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v && typeof (v as { error: unknown }).error === 'string';
}

/**
 * Schema-drift (§ 24.4): en instans utan migration 1700000208 avvisar de nya
 * statusvärdena med 400 "Invalid value" på `status` — säg vilken migration
 * som saknas i stället för PB:s generiska fel.
 */
function withSchemaHint<T>(res: T | { error: string }): T | { error: string } {
  if (isErr(res) && /status/i.test(res.error)) {
    return { error: `${res.error} Saknas statusen i schemat: kör migration 1700000208 (fyrstegsflödet) eller "Sync PocketBase".` };
  }
  return res;
}

/** Läser kortet med användarens token, superuser-fallback vid RLS-miss; tenant verifieras i koden. */
async function loadItem(pb: PocketBase, user: SessionUser, id: string): Promise<FeedbackItem | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;
  const own = await getFeedbackItem(pb, user.tenant, id);
  if (own) return own;
  const su = await superuser();
  if (!su) return null;
  return getFeedbackItem(su, user.tenant, id);
}

/**
 * Området måste vara en sida som är aktiverad på den inloggades profil
 * (§ 36.3) — samma lista som dropdownen visar. Vid redigering får kortets
 * befintliga område alltid stå kvar (ledningen kan redigera kort som rör
 * sidor hen själv inte har i sidmenyn).
 */
function assertAreaAllowed(user: SessionUser, area: string, existingArea?: string): string | null {
  if (existingArea && area === existingArea) return null;
  const allowed = feedbackAreasForUser(user).some((a) => a.id === area);
  return allowed ? null : 'Du kan bara lägga kort på sidor som är aktiverade i din egen sidmeny.';
}

function auditSummary(item: Pick<FeedbackItem, 'title' | 'kind' | 'area' | 'status'>): Record<string, unknown> {
  return {
    title: item.title,
    kind: item.kind,
    area: item.area,
    area_label: feedbackAreaLabel(item.area),
    status: item.status
  };
}

// ─── Skapa / redigera / radera kort ────────────────────────────────────────

export async function createFeedbackAction(input: Record<string, unknown>): Promise<FeedbackActionState> {
  const ctx = await requireSession();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!canCreateFeedback(user.roles)) {
    return { error: 'Bara Movexum-personal kan lägga upp kort.' };
  }

  const v = validateFeedbackInput(input);
  if (!v.ok) return { error: v.error };
  const areaError = assertAreaAllowed(user, v.value.area);
  if (areaError) return { error: areaError };

  const payload = {
    tenant: user.tenant,
    author: user.id,
    title: sanitizePersonnummer(v.value.title),
    description: sanitizePersonnummer(v.value.description),
    kind: v.value.kind,
    area: v.value.area,
    status: 'open'
  };
  const created = await write(
    pb,
    (c) => c.collection(FEEDBACK_ITEMS).create<{ id: string }>(payload),
    'Kunde inte spara kortet.'
  );
  if (isErr(created)) return created;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: FEEDBACK_ITEMS,
    record_id: created.id,
    after_value: { ...auditSummary({ ...payload, status: 'open' }), description_length: payload.description.length }
  });
  revalidate();
  return { ok: true, id: created.id };
}

export async function updateFeedbackAction(id: string, input: Record<string, unknown>): Promise<FeedbackActionState> {
  const ctx = await requireSession();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  if (!canEditFeedback({ id: user.id, roles: user.roles }, existing)) {
    return { error: 'Bara den som skrev kortet (tills det är klart) eller ledningen kan ändra det.' };
  }

  const v = validateFeedbackInput(input);
  if (!v.ok) return { error: v.error };
  const areaError = assertAreaAllowed(user, v.value.area, existing.area);
  if (areaError) return { error: areaError };
  const payload = {
    title: sanitizePersonnummer(v.value.title),
    description: sanitizePersonnummer(v.value.description),
    kind: v.value.kind,
    area: v.value.area
  };
  const res = await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte spara kortet.');
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    before_value: auditSummary(existing),
    after_value: { ...auditSummary({ ...payload, status: existing.status }), description_length: payload.description.length }
  });
  revalidate();
  return { ok: true, id };
}

export async function deleteFeedbackAction(id: string): Promise<FeedbackActionState> {
  const ctx = await requireSession();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  if (!canDeleteFeedback({ id: user.id, roles: user.roles }, existing)) {
    return { error: 'Bara ledningen, eller den som skrev ett ännu obesvarat kort, kan ta bort det.' };
  }

  const res = await write(pb, (c) => c.collection(FEEDBACK_ITEMS).delete(id), 'Kunde inte ta bort kortet.');
  if (isErr(res)) return res;

  // Radering loggas som `update` + `deleted` (§ 30.6-konventionen).
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    before_value: auditSummary(existing),
    after_value: { ...auditSummary(existing), deleted: true }
  });
  revalidate();
  return { ok: true, id };
}

// ─── Svara / flytta / testa (ledningen + testaren) ─────────────────────────

async function requireResponder(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const ctx = await requireSession();
  if ('error' in ctx) return ctx;
  if (!canRespondToFeedback(ctx.user.roles)) {
    return { error: 'Bara admin/incubator lead kan svara på, flytta och klarmarkera kort.' };
  }
  return ctx;
}

type FeedbackNotificationKind =
  | 'feedback_answered'
  | 'feedback_done'
  | 'feedback_started'
  | 'feedback_test'
  | 'feedback_tested';

/** Notis (§ 50). Best-effort; den som utförde handlingen får aldrig sin egen notis (notify dedupar). */
async function notifyFeedback(
  pb: PocketBase,
  user: SessionUser,
  item: FeedbackItem,
  kind: FeedbackNotificationKind,
  recipients: Array<string | null | undefined>,
  snippet?: string
): Promise<void> {
  const ids = Array.from(new Set(recipients.filter((r): r is string => typeof r === 'string' && r.length > 0)));
  if (ids.length === 0) return;
  await notify(pb, {
    tenant: user.tenant,
    recipients: ids,
    kind,
    actorId: user.id,
    entity: { type: 'feedback_items', id: item.id },
    payload: { title: item.title || 'Ett kort under Önskemål & buggar', snippet, href: `/onskemal#kort-${item.id}` }
  }).catch(() => undefined);
}

/** Admin/incubator_lead i tenanten — mottagare av testarens återkoppling. */
async function leadRecipients(pb: PocketBase, tenant: string): Promise<string[]> {
  const staff = await listStaffUsers(pb, tenant);
  return staff.filter((u) => u.roles.includes('admin') || u.roles.includes('incubator_lead')).map((u) => u.id);
}

/** Testaren måste vara Movexum-personal i tenanten (aldrig ett id från klienten rakt in). */
async function assertStaffInTenant(pb: PocketBase, tenant: string, userId: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(userId)) return false;
  const staff = await listStaffUsers(pb, tenant);
  return staff.some((u) => u.id === userId);
}

/**
 * Svar/kommentar från ledningen. Ändrar inte flödet — utom att ett ännu
 * inte påbörjat kort blir Påbörjat (svaret visar att någon tagit tag i det).
 */
export async function answerFeedbackAction(id: string, answer: unknown): Promise<FeedbackActionState> {
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  const v = validateFeedbackAnswer(answer);
  if (!v.ok) return { error: v.error };

  const now = new Date().toISOString();
  const nextStatus: FeedbackStatus = existing.status === 'open' ? 'in_progress' : existing.status;
  const payload: Record<string, unknown> = {
    answer: sanitizePersonnummer(v.value),
    answered_by: user.id,
    answered_at: now,
    status: nextStatus
  };
  const res = withSchemaHint(await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte spara svaret.'));
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'answer',
    before_value: { status: existing.status, had_answer: Boolean(existing.answer) },
    after_value: { ...auditSummary({ ...existing, status: nextStatus }), answer_length: v.value.length }
  });
  await notifyFeedback(pb, user, existing, 'feedback_answered', [existing.author], v.value);
  revalidate();
  return { ok: true, id };
}

/**
 * Flytta ett kort i flödet (ledningen): Öppen → Påbörjad → Väntar
 * återkoppling → Klar, eller tillbaka. `awaiting_feedback` pekar ut
 * författaren som testare när ingen valts (`testerAfterStatusChange`) och
 * notifierar testaren; `done` sätter `done_by/at`; `open`/`in_progress`
 * nollar klar-fälten. Ett valfritt `testerId` (från "Skicka för test") sätter
 * testaren i samma skrivning.
 */
export async function setFeedbackStatusAction(
  id: string,
  status: unknown,
  testerId?: string | null
): Promise<FeedbackActionState> {
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!isFeedbackStatus(status)) return { error: 'Okänd status.' };

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };

  let tester = testerAfterStatusChange(existing, status);
  if (typeof testerId === 'string' && testerId) {
    if (!(await assertStaffInTenant(pb, user.tenant, testerId))) {
      return { error: 'Testaren måste vara Movexum-personal i din organisation.' };
    }
    tester = testerId;
  }
  if (status === existing.status && tester === existing.tester) return { ok: true, id };

  const now = new Date().toISOString();
  const payload: Record<string, unknown> =
    status === 'done'
      ? { status, done_by: user.id, done_at: now, tester: tester ?? '' }
      : { status, done_by: '', done_at: '', tester: tester ?? '' };
  const res = withSchemaHint(await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte ändra status.'));
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'status',
    before_value: { status: existing.status, had_tester: Boolean(existing.tester) },
    after_value: { ...auditSummary({ ...existing, status }), has_tester: Boolean(tester) }
  });

  if (status !== existing.status) {
    if (status === 'done') await notifyFeedback(pb, user, existing, 'feedback_done', [existing.author, existing.tester]);
    else if (status === 'in_progress' && existing.status === 'open') {
      await notifyFeedback(pb, user, existing, 'feedback_started', [existing.author]);
    } else if (status === 'awaiting_feedback') {
      await notifyFeedback(pb, user, existing, 'feedback_test', [tester], existing.answer ?? undefined);
    }
  } else if (status === 'awaiting_feedback' && tester && tester !== existing.tester) {
    // Bytt testare medan kortet väntar — den nya ska få veta.
    await notifyFeedback(pb, user, existing, 'feedback_test', [tester], existing.answer ?? undefined);
  }
  revalidate();
  return { ok: true, id };
}

/** Peka ut (eller ta bort) testare utan att röra statusen (ledningen). */
export async function setFeedbackTesterAction(id: string, testerId: string | null): Promise<FeedbackActionState> {
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  const tester = typeof testerId === 'string' && testerId ? testerId : null;
  if (tester && !(await assertStaffInTenant(pb, user.tenant, tester))) {
    return { error: 'Testaren måste vara Movexum-personal i din organisation.' };
  }
  if (tester === existing.tester) return { ok: true, id };

  const res = await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, { tester: tester ?? '' }), 'Kunde inte spara testaren.');
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'tester',
    before_value: { had_tester: Boolean(existing.tester) },
    after_value: { ...auditSummary(existing), has_tester: Boolean(tester) }
  });
  if (tester && existing.status === 'awaiting_feedback') {
    await notifyFeedback(pb, user, existing, 'feedback_test', [tester], existing.answer ?? undefined);
  }
  revalidate();
  return { ok: true, id };
}

/**
 * Testarens återkoppling när kortet väntar på återkoppling: "fungerar" ⇒
 * Klar (klarmarkerad av testaren), "fungerar inte" ⇒ tillbaka till Påbörjad
 * med noten så ledningen ser vad som återstår. Ledningen får återkoppla
 * själv (de kan testa). Behörigheten är `canTestFeedback` — koden är
 * gränsen; PB:s updateRule släpper igenom testaren (migration 1700000208).
 */
export async function submitFeedbackTestAction(id: string, input: Record<string, unknown>): Promise<FeedbackActionState> {
  const ctx = await requireSession();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  if (!canTestFeedback({ id: user.id, roles: user.roles }, existing)) {
    return {
      error:
        existing.status === 'awaiting_feedback'
          ? 'Bara den utpekade testaren eller ledningen kan återkoppla på kortet.'
          : `Kortet väntar inte på återkoppling (status: ${FEEDBACK_STATUS_LABELS[existing.status]}).`
    };
  }
  const v = validateFeedbackTest(input);
  if (!v.ok) return { error: v.error };

  const now = new Date().toISOString();
  const nextStatus = statusAfterFeedbackTest(v.value.result);
  const noteText = v.value.result === 'ok' ? (v.value.note ? `Fungerar. ${v.value.note}` : 'Fungerar.') : v.value.note;
  const payload: Record<string, unknown> = {
    status: nextStatus,
    test_note: sanitizePersonnummer(noteText),
    tested_at: now,
    ...(nextStatus === 'done' ? { done_by: user.id, done_at: now } : { done_by: '', done_at: '' })
  };
  const res = withSchemaHint(await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte spara återkopplingen.'));
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'test_note',
    before_value: { status: existing.status },
    after_value: { ...auditSummary({ ...existing, status: nextStatus }), test_result: v.value.result, test_note_length: noteText.length }
  });
  const leads = await leadRecipients(pb, user.tenant);
  await notifyFeedback(pb, user, existing, 'feedback_tested', [...leads, existing.answeredBy], noteText);
  if (nextStatus === 'done') await notifyFeedback(pb, user, existing, 'feedback_done', [existing.author]);
  revalidate();
  return { ok: true, id };
}

/** Klarmarkera / återöppna (knapparna på kortet). Återöppning ⇒ Påbörjad om någon jobbat på det, annars Öppen. */
export async function setFeedbackDoneAction(id: string, done: boolean): Promise<FeedbackActionState> {
  if (done) return setFeedbackStatusAction(id, 'done');
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const existing = await loadItem(ctx.pb, ctx.user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  return setFeedbackStatusAction(id, existing.answer || existing.testNote ? 'in_progress' : 'open');
}
