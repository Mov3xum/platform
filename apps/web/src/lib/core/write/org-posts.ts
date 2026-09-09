import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  ORG_POST_KIND_LABELS,
  canEditOrgPost,
  isOrgPostAudience,
  isOrgPostKind,
  validateOrgPostInput,
  type OrgPostAudience,
  type OrgPostKind
} from '@platform/shared';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Hemmaplans inlägg (`org_posts`, § 37) via det delade skrivlagret — så att
 * chatten kan administrera anslagstavlan, "Så gör vi" och framför allt
 * fliken INTERNUTBILDNINGAR ("lägg upp en internutbildning om GDPR på
 * torsdag …") med exakt samma regler som UI:t:
 *
 * - Rollpolicy i `writable-fields.ts` (ORG_POST_AUTHOR_ROLES-kretsen; agenten
 *   kör å den inloggades vägnar och får aldrig mer än rollen).
 * - Ändring kräver `canEditOrgPost` (författaren själv eller admin/
 *   incubator_lead) — samma regel som server-actionen och PB:s updateRule.
 * - Validering via den delade `validateOrgPostInput` (längder, enum, datum,
 *   säker länk) — ingen divergerande kopia.
 * - Personnummer saneras på skrivvägen (§ 15.6-regexen); inläggen är
 *   verksamhetsinformation och ska inte innehålla personuppgifter.
 * - Audit i `agent_actions` (PII-fritt: rubrik/typ/målgrupp) → syns i den
 *   samlade aktivitetsloggen (§ 32) med länk till /hem.
 */

export const ORG_POSTS_WRITE_COLLECTION = 'org_posts';

const EDITABLE_FIELDS = [
  'title',
  'body',
  'kind',
  'audience',
  'pinned',
  'published_at',
  'expires_at',
  'link_url'
] as const;
export type OrgPostWritableField = (typeof EDITABLE_FIELDS)[number];

export interface CreateOrgPostParams {
  title: string;
  body?: string | null;
  kind?: string | null;
  audience?: string | null;
  pinned?: boolean | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  linkUrl?: string | null;
}

export interface OrgPostWriteResultValue {
  postId: string;
  title: string;
  kind: OrgPostKind;
  kindLabel: string;
  audience: OrgPostAudience;
  pinned: boolean;
  homePath: string;
}

interface OrgPostRow {
  id: string;
  tenant?: string;
  author?: string;
  title?: string;
  body?: string;
  kind?: string;
  audience?: string;
  pinned?: boolean;
  published_at?: string;
  expires_at?: string;
  link_url?: string;
}

function homePathFor(kind: OrgPostKind): string {
  if (kind === 'training') return '/hem?flik=internutbildningar';
  if (kind === 'instruction') return '/hem?flik=sa-gor-vi';
  return '/hem';
}

function toPayload(v: ReturnType<typeof validateOrgPostInput>): Record<string, unknown> {
  if (!v.ok) return {};
  return {
    title: sanitizePersonnummer(v.value.title),
    body: sanitizePersonnummer(v.value.body),
    kind: v.value.kind,
    audience: v.value.audience,
    pinned: v.value.pinned,
    published_at: v.value.published_at ?? '',
    expires_at: v.value.expires_at ?? '',
    link_url: v.value.link_url ?? ''
  };
}

export async function createOrgPost(
  pb: PocketBase,
  actor: Actor,
  params: CreateOrgPostParams
): Promise<WriteResult<OrgPostWriteResultValue>> {
  const policy = canCreateRecord(actor, ORG_POSTS_WRITE_COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const kind = params.kind ?? 'news';
  if (!isOrgPostKind(kind)) {
    return fail('INVALID_VALUE', `Okänd inläggstyp '${String(params.kind)}'. Giltiga: ${Object.keys(ORG_POST_KIND_LABELS).join(', ')}.`);
  }
  const audience = params.audience ?? 'staff';
  if (!isOrgPostAudience(audience)) {
    return fail('INVALID_VALUE', "Okänd målgrupp — använd 'staff' eller 'all'.");
  }

  const v = validateOrgPostInput({
    title: params.title,
    body: params.body ?? '',
    kind,
    audience,
    pinned: params.pinned === true,
    published_at: params.publishedAt ?? null,
    expires_at: params.expiresAt ?? null,
    link_url: params.linkUrl ?? null
  });
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload = toPayload(v);

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(ORG_POSTS_WRITE_COLLECTION).create<{ id: string }>({
        ...payload,
        tenant: actor.tenant,
        author: actor.id
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa inlägget.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: ORG_POSTS_WRITE_COLLECTION,
    record_id: created.id,
    after_value: {
      title: payload.title,
      kind: v.value.kind,
      audience: v.value.audience,
      pinned: v.value.pinned
    }
  });

  return ok({
    postId: created.id,
    title: String(payload.title),
    kind: v.value.kind,
    kindLabel: ORG_POST_KIND_LABELS[v.value.kind],
    audience: v.value.audience,
    pinned: v.value.pinned,
    homePath: homePathFor(v.value.kind)
  });
}

export type OrgPostChanges = Partial<Record<OrgPostWritableField, unknown>>;

/**
 * Uppdaterar ett eller flera fält i EN skrivning. Hela det sammanslagna
 * inlägget valideras (så t.ex. utgångsdatum alltid prövas mot publicerings-
 * datum, § 30.4-läxan om fält-för-fält-validering).
 */
export async function updateOrgPostFields(
  pb: PocketBase,
  actor: Actor,
  postId: string,
  changes: OrgPostChanges
): Promise<WriteResult<OrgPostWriteResultValue>> {
  const id = postId.trim();
  if (!id) return fail('INVALID_VALUE', 'post_id saknas.');

  const fields = (Object.keys(changes) as OrgPostWritableField[]).filter((f) =>
    (EDITABLE_FIELDS as readonly string[]).includes(f)
  );
  if (fields.length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  for (const f of fields) {
    const policy = canWriteField(actor, ORG_POSTS_WRITE_COLLECTION, f);
    if (!policy.ok) {
      return fail(
        actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
        policy.reason ?? `Fältet ${f} får inte skrivas.`
      );
    }
  }

  const existing = await getRecordInTenant<OrgPostRow>(
    pb,
    actor,
    ORG_POSTS_WRITE_COLLECTION,
    id,
    'id,tenant,author,title,body,kind,audience,pinned,published_at,expires_at,link_url'
  );
  if (!existing) return fail('NOT_FOUND', 'Inlägget hittades inte i din organisation.');
  if (!canEditOrgPost({ id: actor.id, roles: actor.roles }, { author: existing.author ?? '' })) {
    return fail('FORBIDDEN', 'Bara författaren eller admin/incubator lead kan ändra inlägget.');
  }

  const merged: Record<string, unknown> = {
    title: existing.title ?? '',
    body: existing.body ?? '',
    kind: existing.kind ?? 'news',
    audience: existing.audience ?? 'staff',
    pinned: existing.pinned === true,
    published_at: existing.published_at || null,
    expires_at: existing.expires_at || null,
    link_url: existing.link_url || null
  };
  for (const f of fields) merged[f] = changes[f];
  if (merged.kind !== undefined && !isOrgPostKind(merged.kind)) {
    return fail('INVALID_VALUE', `Okänd inläggstyp. Giltiga: ${Object.keys(ORG_POST_KIND_LABELS).join(', ')}.`);
  }

  const v = validateOrgPostInput(merged);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const full = toPayload(v);
  const payload: Record<string, unknown> = {};
  for (const f of fields) payload[f] = full[f];

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(ORG_POSTS_WRITE_COLLECTION).update(id, payload)
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte uppdatera inlägget.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: ORG_POSTS_WRITE_COLLECTION,
    record_id: id,
    field: fields.length === 1 ? fields[0] : undefined,
    before_value: { title: existing.title },
    after_value: {
      title: full.title,
      kind: v.value.kind,
      audience: v.value.audience,
      pinned: v.value.pinned,
      fields
    }
  });

  return ok({
    postId: id,
    title: String(full.title),
    kind: v.value.kind,
    kindLabel: ORG_POST_KIND_LABELS[v.value.kind],
    audience: v.value.audience,
    pinned: v.value.pinned,
    homePath: homePathFor(v.value.kind)
  });
}
