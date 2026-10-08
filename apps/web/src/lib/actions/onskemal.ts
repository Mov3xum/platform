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
import { notify } from '@/lib/notifications-server';
import {
  canCreateFeedback,
  canDeleteFeedback,
  canEditFeedback,
  canRespondToFeedback,
  feedbackAreaLabel,
  isFeedbackStatus,
  validateFeedbackAnswer,
  validateFeedbackInput
} from '@platform/shared';

/**
 * Önskemål & buggar (CLAUDE.md § 49) — server actions.
 *
 * RBAC: lägga upp kort = Movexum-personal (`FEEDBACK_AUTHOR_ROLES`);
 * redigera = författaren (tills kortet är klart) eller ledningen; svara,
 * klarmarkera och återöppna = ledningen (`FEEDBACK_RESPONDER_ROLES`,
 * admin/incubator_lead). Rollen enforce:as HÄR (PB:s createRule är roll-lös
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

// ─── Svara / klarmarkera / återöppna (ledningen) ───────────────────────────

async function requireResponder(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const ctx = await requireSession();
  if ('error' in ctx) return ctx;
  if (!canRespondToFeedback(ctx.user.roles)) {
    return { error: 'Bara admin/incubator lead kan svara på och klarmarkera kort.' };
  }
  return ctx;
}

/** Notis till kortets författare (§ 50). Best-effort. */
async function notifyFeedbackAuthor(
  pb: PocketBase,
  user: SessionUser,
  item: FeedbackItem,
  kind: 'feedback_answered' | 'feedback_done',
  snippet?: string
): Promise<void> {
  const author = typeof item.author === 'string' ? item.author : '';
  if (!author) return;
  await notify(pb, {
    tenant: user.tenant,
    recipients: [author],
    kind,
    actorId: user.id,
    entity: { type: 'feedback_items', id: item.id },
    payload: { title: item.title || 'Ditt önskemål', snippet, href: `/onskemal#kort-${item.id}` }
  }).catch(() => undefined);
}

export async function answerFeedbackAction(id: string, answer: unknown): Promise<FeedbackActionState> {
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  const v = validateFeedbackAnswer(answer);
  if (!v.ok) return { error: v.error };

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    answer: sanitizePersonnummer(v.value),
    answered_by: user.id,
    answered_at: now,
    // Ett klart kort förblir klart när svaret bara förtydligas.
    status: existing.status === 'done' ? 'done' : 'answered'
  };
  const res = await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte spara svaret.');
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'answer',
    before_value: { status: existing.status, had_answer: Boolean(existing.answer) },
    after_value: { ...auditSummary({ ...existing, status: String(payload.status) as FeedbackItem['status'] }), answer_length: v.value.length }
  });
  await notifyFeedbackAuthor(pb, user, existing, 'feedback_answered', v.value);
  revalidate();
  return { ok: true, id };
}

/**
 * Flytta ett kort till en kolumn på tavlan (ledningen). `done` sätter
 * `done_by/at`; `answered` kräver att ett svar redan finns (kolumnen är
 * "Besvarad", inte en fri hink); `open` återöppnar och nollar klar-fälten.
 */
export async function setFeedbackStatusAction(id: string, status: unknown): Promise<FeedbackActionState> {
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!isFeedbackStatus(status)) return { error: 'Okänd status.' };

  const existing = await loadItem(pb, user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  if (status === existing.status) return { ok: true, id };
  if (status === 'answered' && !existing.answer) {
    return { error: 'Svara på kortet först — kolumnen Besvarad kräver ett svar.' };
  }

  const payload: Record<string, unknown> =
    status === 'done'
      ? { status: 'done', done_by: user.id, done_at: new Date().toISOString() }
      : { status, done_by: '', done_at: '' };
  const res = await write(pb, (c) => c.collection(FEEDBACK_ITEMS).update(id, payload), 'Kunde inte ändra status.');
  if (isErr(res)) return res;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: FEEDBACK_ITEMS,
    record_id: id,
    field: 'status',
    before_value: { status: existing.status },
    after_value: auditSummary({ ...existing, status })
  });
  if (status === 'done') await notifyFeedbackAuthor(pb, user, existing, 'feedback_done');
  revalidate();
  return { ok: true, id };
}

/** Klarmarkera / återöppna (knapparna på kortet). Återöppning ⇒ `answered` om svar finns, annars `open`. */
export async function setFeedbackDoneAction(id: string, done: boolean): Promise<FeedbackActionState> {
  if (done) return setFeedbackStatusAction(id, 'done');
  const ctx = await requireResponder();
  if ('error' in ctx) return { error: ctx.error };
  const existing = await loadItem(ctx.pb, ctx.user, id);
  if (!existing) return { error: 'Kortet hittades inte.' };
  return setFeedbackStatusAction(id, existing.answer ? 'answered' : 'open');
}
