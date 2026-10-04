'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb, type SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { describePbError } from '@/lib/pb-error';
import { COMPETENCE_TAGS } from '@/lib/team/competence-tags.server';
import {
  isCompetenceId,
  normalizeCompetenceTagSlug,
  sanitizeCompetenceTagLabel,
  type CompetenceId,
  type Role
} from '@platform/shared';

/**
 * Kompetens-hashtags — vokabuläradministration (CLAUDE.md § 29.7, steg 3).
 *
 * Ledningen (admin/incubator_lead) godkänner, döper om, flyttar och tar bort
 * taggar i tenantens gemensamma vokabulär `competence_tags`, och kan lägga
 * till nya direkt som godkända. Rollen enforce:as HÄR och i PB:s
 * update-/deleteRule (`STAFF_OR_LEAD`, `:each ?=` § 21.3); createRule är
 * body-låst till `suggested` i eget namn, så en direkt-godkänd tagg skapas
 * i två steg (create → update) via samma regler. Tenant verifieras på varje
 * post innan skrivning (klienten är aldrig säkerhetsgränsen). Superuser-
 * fallback bara vid PB v0.23.4:s tysta regel-nekande. Etiketter saneras
 * (`sanitizeCompetenceTagLabel`) eftersom de når behovsprompten; slugs är
 * oföränderliga (de ligger på personernas profiler). Varje mutation
 * auditeras PII-fritt i `agent_actions` (slug/etikett/område/status).
 * Riskklass n/a (ingen AI-inferens).
 */

const MANAGE_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface CompetenceTagActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

interface TagRecord {
  id: string;
  tenant?: string;
  slug?: string;
  label?: string;
  area?: string;
  status?: string;
}

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

async function requireManager(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, MANAGE_ROLES)) {
    return { error: 'Bara admin eller incubator_lead kan ändra vokabulären.' };
  }
  return { user, pb: await getServerPb() };
}

async function loadTagInTenant(pb: PocketBase, user: SessionUser, id: string): Promise<TagRecord | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  const read = async (client: PocketBase) => {
    try {
      return await client.collection(COMPETENCE_TAGS).getOne<TagRecord>(id, {
        fields: 'id,tenant,slug,label,area,status'
      });
    } catch {
      return null;
    }
  };
  const row = await read(pb);
  if (!row || row.tenant !== user.tenant) return null;
  return row;
}

function revalidate() {
  revalidatePath('/installningar/kompetenser');
  revalidatePath('/installningar');
  revalidatePath('/min-profil');
}

/** Godkänn en föreslagen tagg (eller återställ till föreslagen). */
export async function setCompetenceTagStatusAction(
  id: string,
  status: 'approved' | 'suggested'
): Promise<CompetenceTagActionState> {
  const session = await requireManager();
  if ('error' in session) return { error: session.error };
  const { user, pb } = session;
  const row = await loadTagInTenant(pb, user, id);
  if (!row) return { error: 'Taggen hittades inte i din organisation.' };
  if (status !== 'approved' && status !== 'suggested') return { error: 'Ogiltig status.' };
  try {
    await writeWithFallback(pb, (c) => c.collection(COMPETENCE_TAGS).update(row.id, { status }), {
      fallbackOn404: true
    });
  } catch (err) {
    return { error: describePbError(err, 'Kunde inte ändra status.') };
  }
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: COMPETENCE_TAGS,
    record_id: row.id,
    field: 'status',
    before_value: row.status,
    after_value: { slug: row.slug, status }
  });
  revalidate();
  return { ok: true, id: row.id };
}

/** Byt visningsetikett och/eller område. Sluggen är oföränderlig. */
export async function updateCompetenceTagAction(
  id: string,
  input: { label?: string; area?: string }
): Promise<CompetenceTagActionState> {
  const session = await requireManager();
  if ('error' in session) return { error: session.error };
  const { user, pb } = session;
  const row = await loadTagInTenant(pb, user, id);
  if (!row) return { error: 'Taggen hittades inte i din organisation.' };

  const patch: Record<string, string> = {};
  if (input.label !== undefined) {
    const label = sanitizeCompetenceTagLabel(input.label);
    if (!label) return { error: 'Etiketten får inte vara tom (bokstäver, siffror, & / ( ) + . -).' };
    patch.label = label;
  }
  if (input.area !== undefined) {
    if (!isCompetenceId(input.area)) return { error: 'Okänt kompetensområde.' };
    patch.area = input.area;
  }
  if (Object.keys(patch).length === 0) return { error: 'Inget att ändra.' };

  try {
    await writeWithFallback(pb, (c) => c.collection(COMPETENCE_TAGS).update(row.id, patch), {
      fallbackOn404: true
    });
  } catch (err) {
    return { error: describePbError(err, 'Kunde inte spara taggen.') };
  }
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: COMPETENCE_TAGS,
    record_id: row.id,
    field: Object.keys(patch).join(','),
    before_value: { label: row.label, area: row.area },
    after_value: { slug: row.slug, ...patch }
  });
  revalidate();
  return { ok: true, id: row.id };
}

/**
 * Ta bort en tagg ur vokabulären. Personer som har taggen behåller den på
 * sin profil (visas då som egen tagg) — vi raderar aldrig andras val.
 */
export async function deleteCompetenceTagAction(id: string): Promise<CompetenceTagActionState> {
  const session = await requireManager();
  if ('error' in session) return { error: session.error };
  const { user, pb } = session;
  const row = await loadTagInTenant(pb, user, id);
  if (!row) return { error: 'Taggen hittades inte i din organisation.' };
  try {
    await writeWithFallback(pb, (c) => c.collection(COMPETENCE_TAGS).delete(row.id), {
      fallbackOn404: true
    });
  } catch (err) {
    return { error: describePbError(err, 'Kunde inte ta bort taggen.') };
  }
  // Radering loggas som `update` + `deleted` (§ 30.6-konventionen).
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: COMPETENCE_TAGS,
    record_id: row.id,
    after_value: { slug: row.slug, area: row.area, deleted: true }
  });
  revalidate();
  return { ok: true, id: row.id };
}

/** Lägg till en ny, direkt godkänd tagg i vokabulären. */
export async function createCompetenceTagAction(input: {
  label: string;
  area: string;
}): Promise<CompetenceTagActionState> {
  const session = await requireManager();
  if ('error' in session) return { error: session.error };
  const { user, pb } = session;
  const label = sanitizeCompetenceTagLabel(input.label);
  const slug = normalizeCompetenceTagSlug(input.label);
  if (!label || !slug) return { error: 'Ange ett namn på taggen (bokstäver, siffror, bindestreck).' };
  if (!isCompetenceId(input.area)) return { error: 'Välj ett kompetensområde.' };
  const area: CompetenceId = input.area;

  let created: { id: string };
  try {
    // createRule är body-låst till status=suggested i eget namn (§ 29.7) —
    // godkännandet görs i ett andra steg via updateRule (ledning).
    created = await writeWithFallback(pb, (c) =>
      c.collection(COMPETENCE_TAGS).create<{ id: string }>({
        tenant: user.tenant,
        slug,
        label,
        area,
        status: 'suggested',
        created_by: user.id
      })
    );
  } catch (err) {
    const msg = describePbError(err, 'Kunde inte skapa taggen.');
    return { error: /unique/i.test(msg) ? `Taggen #${slug} finns redan.` : msg };
  }
  try {
    await writeWithFallback(
      pb,
      (c) => c.collection(COMPETENCE_TAGS).update(created.id, { status: 'approved' }),
      { fallbackOn404: true }
    );
  } catch {
    /* kvarstår som suggested — syns i godkännandekön */
  }
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: COMPETENCE_TAGS,
    record_id: created.id,
    after_value: { slug, area, status: 'approved' }
  });
  revalidate();
  return { ok: true, id: created.id };
}
