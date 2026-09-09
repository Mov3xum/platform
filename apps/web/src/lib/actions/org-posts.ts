'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser, type SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { ORG_POSTS_COLLECTION, rowToOrgPost } from '@/lib/org-posts/data';
import {
  ORG_POST_AUTHOR_ROLES,
  canEditOrgPost,
  validateOrgPostInput,
  type OrgPost,
  type OrgPostInput
} from '@platform/shared';

/**
 * Hemmaplans anslagstavla (CLAUDE.md § 37) — server actions.
 *
 * RBAC: skriva = admin/incubator_lead/coach/mentor (`ORG_POST_AUTHOR_ROLES`);
 * ändra/radera = författaren själv eller admin/incubator_lead (`canEditOrgPost`).
 * Rollen enforce:as HÄR (PB:s createRule är roll-lös per § 21.3); tenant
 * stämplas alltid server-side från den inloggade — aldrig från klienten.
 * Skrivningar går via användarens token med superuser-fallback ENBART vid
 * PB v0.23.4:s tysta regel-nekande (400/403), efter verifierad roll — samma
 * mönster som § 18.3/§ 20.5/§ 30.4. Varje mutation audit-loggas i
 * `agent_actions` (PII-fritt: rubrik/typ/målgrupp) så den syns i den samlade
 * aktivitetsloggen (§ 32). Riskklass n/a — ingen AI-inferens.
 */

export interface OrgPostActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

function revalidate() {
  revalidatePath('/hem');
  revalidatePath('/min-oversikt');
  revalidatePath('/chatt');
}

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

async function requireAuthor(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, ORG_POST_AUTHOR_ROLES)) {
    return { error: 'Bara Movexum-personal kan skriva på anslagstavlan.' };
  }
  const pb = await getServerPb();
  return { user, pb };
}

/** Superuser-klient för fallback när rule-eval tyst nekar (roll redan verifierad). */
async function superuser(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[org-posts] superuser unavailable — ingen fallback', { reason: su.reason });
    return null;
  }
  return su.pb;
}

function isRuleDenial(err: unknown): boolean {
  const status = pbStatus(err);
  return status === 400 || status === 403 || status === 404;
}

/** Läser inlägget och verifierar tenant (fallback till superuser vid RLS-miss). */
async function loadOwnPost(pb: PocketBase, user: SessionUser, id: string): Promise<OrgPost | null> {
  const read = async (client: PocketBase) => {
    const row = await client
      .collection(ORG_POSTS_COLLECTION)
      .getOne<Parameters<typeof rowToOrgPost>[0]>(id, { expand: 'author' });
    const post = rowToOrgPost(row);
    return post.tenant === user.tenant ? post : null;
  };
  try {
    return await read(pb);
  } catch (err) {
    if (!isRuleDenial(err)) return null;
    const su = await superuser();
    if (!su) return null;
    try {
      return await read(su);
    } catch {
      return null;
    }
  }
}

function toPayload(value: OrgPostInput): Record<string, unknown> {
  return {
    title: value.title,
    body: value.body,
    kind: value.kind,
    audience: value.audience,
    pinned: value.pinned,
    published_at: value.published_at ?? '',
    expires_at: value.expires_at ?? '',
    link_url: value.link_url ?? ''
  };
}

export async function createOrgPostAction(
  input: Record<string, unknown>
): Promise<OrgPostActionState> {
  const ctx = await requireAuthor();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const v = validateOrgPostInput(input);
  if (!v.ok) return { error: v.error };

  const payload = { ...toPayload(v.value), tenant: user.tenant, author: user.id };
  let created: { id: string; tenant?: string } | null = null;
  try {
    created = await pb.collection(ORG_POSTS_COLLECTION).create(payload);
  } catch (err) {
    if (!isRuleDenial(err)) {
      return { error: describePbError(err, 'Kunde inte publicera inlägget.') };
    }
    const su = await superuser();
    if (!su) return { error: describePbError(err, 'Kunde inte publicera inlägget.') };
    try {
      created = await su.collection(ORG_POSTS_COLLECTION).create(payload);
    } catch (err2) {
      return { error: describePbError(err2, 'Kunde inte publicera inlägget.') };
    }
  }
  if (!created?.id) return { error: 'Kunde inte publicera inlägget.' };

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: ORG_POSTS_COLLECTION,
    record_id: created.id,
    after_value: {
      title: v.value.title,
      kind: v.value.kind,
      audience: v.value.audience,
      pinned: v.value.pinned
    }
  });
  revalidate();
  return { ok: true, id: created.id };
}

export async function updateOrgPostAction(
  id: string,
  input: Record<string, unknown>
): Promise<OrgPostActionState> {
  const ctx = await requireAuthor();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!id) return { error: 'Inlägget saknas.' };

  const existing = await loadOwnPost(pb, user, id);
  if (!existing) return { error: 'Inlägget hittades inte.' };
  if (!canEditOrgPost({ id: user.id, roles: user.roles }, existing)) {
    return { error: 'Bara författaren eller admin/incubator lead kan ändra inlägget.' };
  }

  const v = validateOrgPostInput(input);
  if (!v.ok) return { error: v.error };
  const payload = toPayload(v.value);

  try {
    await pb.collection(ORG_POSTS_COLLECTION).update(id, payload);
  } catch (err) {
    if (!isRuleDenial(err)) return { error: describePbError(err, 'Kunde inte spara inlägget.') };
    const su = await superuser();
    if (!su) return { error: describePbError(err, 'Kunde inte spara inlägget.') };
    try {
      await su.collection(ORG_POSTS_COLLECTION).update(id, payload);
    } catch (err2) {
      return { error: describePbError(err2, 'Kunde inte spara inlägget.') };
    }
  }

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ORG_POSTS_COLLECTION,
    record_id: id,
    before_value: { title: existing.title },
    after_value: { title: v.value.title, kind: v.value.kind, audience: v.value.audience }
  });
  revalidate();
  return { ok: true, id };
}

export async function setOrgPostPinnedAction(id: string, pinned: boolean): Promise<OrgPostActionState> {
  const ctx = await requireAuthor();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  const existing = await loadOwnPost(pb, user, id);
  if (!existing) return { error: 'Inlägget hittades inte.' };
  if (!canEditOrgPost({ id: user.id, roles: user.roles }, existing)) {
    return { error: 'Bara författaren eller admin/incubator lead kan fästa inlägget.' };
  }
  try {
    await pb.collection(ORG_POSTS_COLLECTION).update(id, { pinned });
  } catch (err) {
    if (!isRuleDenial(err)) return { error: describePbError(err, 'Kunde inte ändra inlägget.') };
    const su = await superuser();
    if (!su) return { error: describePbError(err, 'Kunde inte ändra inlägget.') };
    try {
      await su.collection(ORG_POSTS_COLLECTION).update(id, { pinned });
    } catch (err2) {
      return { error: describePbError(err2, 'Kunde inte ändra inlägget.') };
    }
  }
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ORG_POSTS_COLLECTION,
    record_id: id,
    field: 'pinned',
    before_value: existing.pinned,
    after_value: { title: existing.title, pinned }
  });
  revalidate();
  return { ok: true, id };
}

export async function deleteOrgPostAction(id: string): Promise<OrgPostActionState> {
  const ctx = await requireAuthor();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  const existing = await loadOwnPost(pb, user, id);
  if (!existing) return { error: 'Inlägget hittades inte.' };
  if (!canEditOrgPost({ id: user.id, roles: user.roles }, existing)) {
    return { error: 'Bara författaren eller admin/incubator lead kan ta bort inlägget.' };
  }
  try {
    await pb.collection(ORG_POSTS_COLLECTION).delete(id);
  } catch (err) {
    if (!isRuleDenial(err)) return { error: describePbError(err, 'Kunde inte ta bort inlägget.') };
    const su = await superuser();
    if (!su) return { error: describePbError(err, 'Kunde inte ta bort inlägget.') };
    try {
      await su.collection(ORG_POSTS_COLLECTION).delete(id);
    } catch (err2) {
      return { error: describePbError(err2, 'Kunde inte ta bort inlägget.') };
    }
  }
  // action_type har bara create|update|revert — radering loggas som update
  // med `deleted` (samma konvention som årshjulets kategorier, § 30.6).
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ORG_POSTS_COLLECTION,
    record_id: id,
    after_value: { title: existing.title, deleted: true }
  });
  revalidate();
  return { ok: true, id };
}
