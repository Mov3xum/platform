import 'server-only';
import type PocketBase from 'pocketbase';
import {
  EMAIL_CAMPAIGN_STATUS_LABELS,
  audienceHasRecipients,
  campaignEditable,
  isEmailEventGroup,
  emailTemplateByKey,
  instantiateEmailTemplate,
  normalizeEmailCampaignContent,
  parseSuppressionImport,
  validateEmailCampaignDraft,
  validateEmailCampaignForSend,
  type EmailCampaignInput,
  type EmailEventGroup,
  type EmailSuppressionReason
} from '@platform/shared';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { CAMPAIGNS, CAMPAIGN_MIGRATION_HINT, getCampaign, type CampaignRow } from '@/lib/email/campaign-data';
import { dispatchCampaign, resolveCampaignCandidates, sendCampaignTest } from '@/lib/email/campaign-dispatch';
import { addSuppression, removeSuppression } from '@/lib/email/suppression';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * E-postkampanjer (CLAUDE.md § 55) — det delade skrivlagret.
 *
 * - Bara människor (policy `email_campaigns`, agent nekad). Tenant verifieras
 *   på varje kampanj, event och avsändare i koden; superuser bara som reserv
 *   vid PB v0.23.4:s tysta regel-nekande (§ 21.3).
 * - Innehållet normaliseras/valideras av `@platform/shared` (block, länkar,
 *   platshållare); fritext personnummer-saneras.
 * - Utskick och test går via `lib/email/campaign-dispatch.ts` (en kärna för
 *   "Skicka nu" och cron). Audit i `agent_actions` är PII-fri (titel,
 *   status, antal) — aldrig mottagare.
 */

export const CAMPAIGN_ROLES_HINT = 'Bara admin, inkubatorledning och coacher kan hantera kampanjer.';

export function campaignPath(id: string): string {
  return `/inflode/kampanjer/${encodeURIComponent(id)}`;
}

function guard(actor: Actor): WriteResult<never> | null {
  const policy = canCreateRecord(actor, 'email_campaigns');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? CAMPAIGN_ROLES_HINT);
  return null;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function cleanInput(raw: EmailCampaignInput): EmailCampaignInput {
  const clean = (v: unknown) => (typeof v === 'string' ? sanitizePersonnummer(v) : v);
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map((b) => {
        if (!b || typeof b !== 'object') return b;
        const r = { ...(b as Record<string, unknown>) };
        for (const k of ['text', 'label', 'alt', 'name', 'title']) if (typeof r[k] === 'string') r[k] = sanitizePersonnummer(r[k] as string);
        return r;
      })
    : raw.blocks;
  return { ...raw, title: clean(raw.title), subject: clean(raw.subject), preheader: clean(raw.preheader), sender_name: clean(raw.sender_name), blocks };
}

async function verifyRefs(
  pb: PocketBase,
  actor: Actor,
  refs: { eventId?: unknown; senderUserId?: unknown; surveyId?: unknown }
): Promise<WriteResult<{ event: string | null; senderUser: string | null; survey: string | null }>> {
  let event: string | null = null;
  let senderUser: string | null = null;
  let survey: string | null = null;
  const ID = /^[a-zA-Z0-9_-]{1,64}$/;
  if (typeof refs.eventId === 'string' && refs.eventId) {
    if (!ID.test(refs.eventId)) return fail('INVALID_VALUE', 'Ogiltigt event.');
    const ev = await getRecordInTenant<{ id: string; tenant?: string }>(pb, actor, 'incubator_events', refs.eventId, 'id,tenant');
    if (!ev) return fail('NOT_FOUND', 'Eventet hittades inte i din organisation.');
    event = ev.id;
  }
  if (typeof refs.surveyId === 'string' && refs.surveyId) {
    if (!ID.test(refs.surveyId)) return fail('INVALID_VALUE', 'Ogiltig utvärdering.');
    const sv = await getRecordInTenant<{ id: string; tenant?: string; is_template?: boolean }>(pb, actor, 'surveys', refs.surveyId, 'id,tenant,is_template');
    if (!sv) return fail('NOT_FOUND', 'Utvärderingen hittades inte i din organisation.');
    if (sv.is_template) return fail('INVALID_VALUE', 'En enkätmall kan inte skickas — skapa en utvärdering från den först.');
    survey = sv.id;
  }
  if (typeof refs.senderUserId === 'string' && refs.senderUserId) {
    if (!ID.test(refs.senderUserId)) return fail('INVALID_VALUE', 'Ogiltig avsändare.');
    // Avsändaren måste vara Movexum-personal i tenanten (svarsadressen blir
    // hens e-post). Läses via superusern — användarnas roller/e-post är dolda.
    const su = await getSuperuserPb();
    const client = su.ok ? su.pb : pb;
    try {
      const u = await client.collection('users').getOne<{ tenant?: string; roles?: unknown }>(refs.senderUserId, { fields: 'id,tenant,roles' });
      const roles = Array.isArray(u.roles) ? (u.roles as string[]) : [];
      if (u.tenant !== actor.tenant || !roles.some((r) => ['admin', 'incubator_lead', 'coach', 'mentor'].includes(r))) {
        return fail('INVALID_VALUE', 'Avsändaren måste vara Movexum-personal i din organisation.');
      }
      senderUser = refs.senderUserId;
    } catch {
      return fail('NOT_FOUND', 'Avsändaren hittades inte.');
    }
  }
  return ok({ event, senderUser, survey });
}

export interface CampaignWriteResult {
  id: string;
  path: string;
  title: string;
  /** Fält som inte fastnade i schemat (PB släpper okända fält tyst, § 24.4). */
  warning?: string;
}

const SCHEMA_FIELDS = ['blocks', 'design', 'audience', 'consent_mode', 'category'];

function schemaWarning(row: Record<string, unknown>): string | undefined {
  const missing = SCHEMA_FIELDS.filter((f) => !(f in row));
  return missing.length ? `${CAMPAIGN_MIGRATION_HINT} (saknade fält: ${missing.join(', ')})` : undefined;
}

/**
 * Skapar ett utkast — tomt, från en inbyggd mallstruktur (`templateKey`),
 * från en egen sparad mall eller som kopia av en kampanj (`fromId`).
 */
export interface CreateCampaignInput {
  templateKey?: unknown;
  fromId?: unknown;
  eventId?: unknown;
  /** Kopplad utvärdering (§ 47) — fyller {{utvärdering.länk}}. */
  surveyId?: unknown;
  /** Eventets deltagarlista som mottagargrupp (§ 55.3); kräver `eventId`. */
  eventGroup?: unknown;
  title?: unknown;
  isTemplate?: boolean;
}

export async function createEmailCampaign(pb: PocketBase, actor: Actor, input: CreateCampaignInput): Promise<WriteResult<CampaignWriteResult>> {
  const denied = guard(actor);
  if (denied) return denied;
  const refs = await verifyRefs(pb, actor, { eventId: input.eventId, surveyId: input.surveyId });
  if (!refs.ok) return refs;
  if (input.eventGroup !== undefined && input.eventGroup !== null && input.eventGroup !== '' && !isEmailEventGroup(input.eventGroup)) {
    return fail('INVALID_VALUE', 'Okänd mottagargrupp.');
  }
  const eventGroup = isEmailEventGroup(input.eventGroup) ? input.eventGroup : null;
  if (eventGroup && !refs.value.event) return fail('INVALID_VALUE', 'Mottagargruppen kräver ett kopplat event.');

  let base: EmailCampaignInput = {};
  let templateKey = '';
  let eventId = refs.value.event;
  let surveyId = refs.value.survey;
  let senderUser: string | null = null;
  if (typeof input.fromId === 'string' && input.fromId) {
    const src = await getCampaign(pb, actor.tenant, input.fromId);
    if (!src) return fail('NOT_FOUND', 'Mallen/kampanjen hittades inte.');
    base = {
      title: src.title,
      subject: src.subject,
      preheader: src.preheader,
      category: src.category,
      consent_mode: src.consent_mode,
      blocks: src.blocks,
      design: src.design,
      sender_name: src.sender_name,
      audience: src.is_template ? undefined : src.audience
    };
    templateKey = src.template_key;
    eventId = eventId ?? (src.is_template ? null : src.event);
    surveyId = surveyId ?? (src.is_template ? null : src.survey);
    senderUser = src.sender_user;
  } else {
    const t = emailTemplateByKey(input.templateKey);
    if (t) {
      base = {
        title: t.name,
        subject: t.subject,
        preheader: t.preheader,
        category: t.category,
        blocks: instantiateEmailTemplate(t),
        design: t.design
      };
      templateKey = t.key;
    }
  }
  const content = normalizeEmailCampaignContent(
    cleanInput({ ...base, ...(typeof input.title === 'string' && input.title.trim() ? { title: input.title } : {}) })
  );
  if (eventGroup) content.audience = { ...content.audience, event_group: eventGroup };
  if (!content.title) content.title = input.isTemplate ? 'Ny mall' : 'Nytt utskick';
  const v = validateEmailCampaignDraft(content);
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  let created: Record<string, unknown>;
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(CAMPAIGNS).create<Record<string, unknown>>({
        tenant: actor.tenant,
        title: content.title,
        subject: content.subject,
        preheader: content.preheader,
        category: content.category,
        consent_mode: content.consent_mode,
        status: 'draft',
        template_key: templateKey,
        blocks: content.blocks,
        design: content.design,
        audience: content.audience,
        sender_name: content.sender_name,
        ...(senderUser ? { sender_user: senderUser } : {}),
        ...(eventId ? { event: eventId } : {}),
        ...(surveyId ? { survey: surveyId } : {}),
        is_template: Boolean(input.isTemplate),
        created_by: actor.id
      })
    );
  } catch (err) {
    if (statusOf(err) === 404) return fail('DB_ERROR', CAMPAIGN_MIGRATION_HINT);
    console.error('[campaigns] create failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte skapa utskicket.');
  }
  const id = String(created.id);
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CAMPAIGNS,
    record_id: id,
    after_value: { title: content.title, template: templateKey, is_template: Boolean(input.isTemplate) }
  });
  return ok({ id, path: campaignPath(id), title: content.title, warning: schemaWarning(created) });
}

/** Sparar innehåll + inställningar. Bara utkast/schemalagda kan ändras. */
export async function updateEmailCampaign(
  pb: PocketBase,
  actor: Actor,
  id: string,
  input: EmailCampaignInput & { eventId?: unknown; senderUserId?: unknown; surveyId?: unknown }
): Promise<WriteResult<CampaignWriteResult>> {
  const denied = guard(actor);
  if (denied) return denied;
  const current = await getCampaign(pb, actor.tenant, id);
  if (!current) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  if (!campaignEditable(current.status)) {
    return fail('STATE_TRANSITION', `Utskicket är ${EMAIL_CAMPAIGN_STATUS_LABELS[current.status].toLowerCase()} och kan inte ändras. Duplicera det i stället.`);
  }
  const refs = await verifyRefs(pb, actor, { eventId: input.eventId, senderUserId: input.senderUserId, surveyId: input.surveyId });
  if (!refs.ok) return refs;
  const content = normalizeEmailCampaignContent(cleanInput(input));
  if (content.audience.event_group && !refs.value.event) {
    return fail('INVALID_VALUE', 'Mottagargruppen "eventets deltagare" kräver ett kopplat event.');
  }
  const v = validateEmailCampaignDraft(content);
  if (!v.ok) return fail('INVALID_VALUE', v.error);

  let updated: Record<string, unknown>;
  try {
    updated = await writeWithFallback(
      pb,
      (client) =>
        client.collection(CAMPAIGNS).update<Record<string, unknown>>(current.id, {
          title: content.title,
          subject: content.subject,
          preheader: content.preheader,
          category: content.category,
          consent_mode: content.consent_mode,
          blocks: content.blocks,
          design: content.design,
          audience: content.audience,
          sender_name: content.sender_name,
          sender_user: refs.value.senderUser ?? '',
          event: refs.value.event ?? '',
          survey: refs.value.survey ?? ''
        }),
      { fallbackOn404: true }
    );
  } catch (err) {
    console.error('[campaigns] update failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte spara utskicket.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CAMPAIGNS,
    record_id: current.id,
    field: 'content',
    after_value: { title: content.title, blocks: content.blocks.length, recipients: content.audience.keys.length, category: content.category }
  });
  return ok({ id: current.id, path: campaignPath(current.id), title: content.title, warning: schemaWarning(updated) });
}

export async function deleteEmailCampaign(pb: PocketBase, actor: Actor, id: string): Promise<WriteResult<{ title: string }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const current = await getCampaign(pb, actor.tenant, id);
  if (!current) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  if (current.status === 'sending') return fail('STATE_TRANSITION', 'Utskicket pågår — vänta tills det är klart.');
  try {
    await writeWithFallback(pb, (c) => c.collection(CAMPAIGNS).delete(current.id), { fallbackOn404: true });
  } catch (err) {
    console.error('[campaigns] delete failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte ta bort utskicket.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CAMPAIGNS,
    record_id: current.id,
    after_value: { title: current.title, deleted: true, was_sent: current.status === 'sent' }
  });
  return ok({ title: current.title });
}

/** Sparar kampanjens innehåll som egen mall (utan mottagare och event). */
export async function saveCampaignAsTemplate(pb: PocketBase, actor: Actor, id: string, title: unknown): Promise<WriteResult<CampaignWriteResult>> {
  const denied = guard(actor);
  if (denied) return denied;
  const src = await getCampaign(pb, actor.tenant, id);
  if (!src) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  return createEmailCampaign(pb, actor, { fromId: src.id, title: typeof title === 'string' && title.trim() ? title : `Mall: ${src.title}`, isTemplate: true });
}

/** Antal mottagare som skulle få utskicket just nu (samma upplösning som utskicket). */
export async function previewCampaignRecipients(
  pb: PocketBase,
  actor: Actor,
  id: string
): Promise<WriteResult<{ total: number; sendable: number; blocked: Array<{ name: string; organization: string; why: string }> }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const campaign = await getCampaign(pb, actor.tenant, id);
  if (!campaign) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  const su = await getSuperuserPb();
  const client = su.ok ? su.pb : pb;
  try {
    const candidates = await resolveCampaignCandidates(client, campaign);
    const blocked = candidates.filter((c) => c.blocked).map((c) => ({ name: c.name, organization: c.organization, why: c.blockedWhy ?? '' }));
    return ok({ total: candidates.length, sendable: candidates.length - blocked.length, blocked: blocked.slice(0, 200) });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error && err.message.includes('superuser') ? err.message : 'Kunde inte räkna mottagarna.');
  }
}

async function readyToSend(pb: PocketBase, actor: Actor, id: string): Promise<WriteResult<CampaignRow>> {
  const campaign = await getCampaign(pb, actor.tenant, id);
  if (!campaign) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  if (campaign.is_template) return fail('STATE_TRANSITION', 'En mall skickas inte — skapa ett utskick från den.');
  if (campaign.status === 'sent') return fail('STATE_TRANSITION', 'Utskicket är redan skickat.');
  if (campaign.status === 'sending') return fail('STATE_TRANSITION', 'Utskicket pågår.');
  const v = validateEmailCampaignForSend(campaign, { hasEvent: Boolean(campaign.event), recipients: campaign.audience.keys.length });
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  if (!audienceHasRecipients(campaign.audience)) return fail('INVALID_VALUE', 'Välj minst en mottagare.');
  return ok(campaign);
}

/**
 * Systemkampanj (§ 55.4): skapas av servern — påminnelse-ticken och
 * enkätutskicket — utan inloggad människa, med superuser. Ingen rollgrind
 * (anroparen har redan verifierat event/enkät och tenant), men samma mall,
 * normalisering och rendering som ett mänskligt utskick, så den syns i
 * Kampanjer med statistik precis som allt annat. `created_by` lämnas tomt.
 */
export async function createSystemCampaign(
  pb: PocketBase,
  input: { tenant: string; templateKey: string; eventId: string; eventGroup: EmailEventGroup; surveyId?: string | null; title?: string }
): Promise<WriteResult<CampaignWriteResult>> {
  const t = emailTemplateByKey(input.templateKey);
  if (!t) return fail('INVALID_VALUE', 'Okänd mallstruktur.');
  const content = normalizeEmailCampaignContent({
    title: input.title || t.name,
    subject: t.subject,
    preheader: t.preheader,
    category: t.category,
    blocks: instantiateEmailTemplate(t),
    design: t.design,
    audience: { list: 'everyone', keys: [], event_group: input.eventGroup }
  });
  let created: Record<string, unknown>;
  try {
    created = await pb.collection(CAMPAIGNS).create<Record<string, unknown>>({
      tenant: input.tenant,
      title: content.title,
      subject: content.subject,
      preheader: content.preheader,
      category: content.category,
      consent_mode: content.consent_mode,
      status: 'draft',
      template_key: t.key,
      blocks: content.blocks,
      design: content.design,
      audience: content.audience,
      sender_name: '',
      event: input.eventId,
      ...(input.surveyId ? { survey: input.surveyId } : {})
    });
  } catch (err) {
    if (statusOf(err) === 404) return fail('DB_ERROR', CAMPAIGN_MIGRATION_HINT);
    console.error('[campaigns] system create failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte skapa utskicket.');
  }
  const id = String(created.id);
  return ok({ id, path: campaignPath(id), title: content.title, warning: schemaWarning(created) });
}

/** Schemalägger utskicket (cron-ticken gör själva utskicket). */
export async function scheduleEmailCampaign(
  pb: PocketBase,
  actor: Actor,
  id: string,
  sendAt: Date,
  baseUrl: string
): Promise<WriteResult<{ sendAt: string }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const ready = await readyToSend(pb, actor, id);
  if (!ready.ok) return ready;
  if (Number.isNaN(sendAt.getTime())) return fail('INVALID_VALUE', 'Ogiltig tidpunkt.');
  if (sendAt.getTime() < Date.now() - 60_000) return fail('INVALID_VALUE', 'Tidpunkten har redan passerat — använd "Skicka nu".');
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) return fail('INVALID_VALUE', 'Ingen giltig adress för länkarna i mejlet.');
  try {
    const row = await writeWithFallback(
      pb,
      (c) =>
        c.collection(CAMPAIGNS).update<Record<string, unknown>>(ready.value.id, {
          status: 'scheduled',
          send_at: sendAt.toISOString(),
          send_base_url: baseUrl,
          last_error: ''
        }),
      { fallbackOn404: true }
    );
    if (!row.send_at) return fail('DB_ERROR', CAMPAIGN_MIGRATION_HINT);
  } catch (err) {
    console.error('[campaigns] schedule failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte schemalägga utskicket.');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CAMPAIGNS,
    record_id: ready.value.id,
    field: 'scheduled',
    after_value: { title: ready.value.title, send_at: sendAt.toISOString(), recipients: ready.value.audience.keys.length }
  });
  return ok({ sendAt: sendAt.toISOString() });
}

export async function cancelEmailCampaignSchedule(pb: PocketBase, actor: Actor, id: string): Promise<WriteResult<void>> {
  const denied = guard(actor);
  if (denied) return denied;
  const campaign = await getCampaign(pb, actor.tenant, id);
  if (!campaign) return fail('NOT_FOUND', 'Utskicket hittades inte.');
  if (campaign.status !== 'scheduled') return fail('STATE_TRANSITION', 'Utskicket är inte schemalagt.');
  try {
    await writeWithFallback(pb, (c) => c.collection(CAMPAIGNS).update(campaign.id, { status: 'draft', send_at: '' }), { fallbackOn404: true });
  } catch (err) {
    console.error('[campaigns] cancel failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte avbryta schemaläggningen.');
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: CAMPAIGNS, record_id: campaign.id, field: 'schedule_cancelled', after_value: { title: campaign.title } });
  return ok(undefined);
}

/** "Skicka nu" — ett mänskligt klick med bekräftelse. */
export async function sendEmailCampaignNow(
  pb: PocketBase,
  actor: Actor,
  id: string,
  baseUrl: string
): Promise<WriteResult<{ recipients: number; sent: number; failed: number; suppressed: number; failReason?: string }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const ready = await readyToSend(pb, actor, id);
  if (!ready.ok) return ready;
  const res = await dispatchCampaign(ready.value.id, { baseUrl, actorId: actor.id });
  if (!res.ok) return fail('DB_ERROR', res.error);
  return ok({ recipients: res.recipients, sent: res.sent, failed: res.failed, suppressed: res.suppressed, ...(res.failReason ? { failReason: res.failReason } : {}) });
}

/** Testmejl till den inloggades egen adress. */
export async function sendEmailCampaignTest(pb: PocketBase, actor: Actor, id: string, to: string, baseUrl: string): Promise<WriteResult<void>> {
  const denied = guard(actor);
  if (denied) return denied;
  const res = await sendCampaignTest(pb, actor.tenant, id, to, baseUrl);
  if (!res.ok) return fail('DB_ERROR', res.error);
  return ok(undefined);
}

// ── Spärrlista & samtycke ───────────────────────────────────────────────────

function suppressionGuard(actor: Actor): WriteResult<never> | null {
  const policy = canCreateRecord(actor, 'email_suppressions');
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
  return null;
}

export async function addManualSuppression(
  pb: PocketBase,
  actor: Actor,
  input: { email: unknown; reason?: unknown; note?: unknown }
): Promise<WriteResult<{ created: boolean }>> {
  const denied = suppressionGuard(actor);
  if (denied) return denied;
  const reason: EmailSuppressionReason = input.reason === 'unsubscribe' || input.reason === 'bounce' ? input.reason : 'manual';
  const res = await addSuppression({
    tenant: actor.tenant,
    email: typeof input.email === 'string' ? input.email : '',
    reason,
    source: 'staff',
    note: typeof input.note === 'string' ? sanitizePersonnummer(input.note) : '',
    createdBy: actor.id
  });
  if (!res.ok) return fail('DB_ERROR', res.error);
  await logAgentAction(pb, { actor, action_type: 'create', collection: 'email_suppressions', record_id: actor.tenant, after_value: { reason, created: res.created } });
  return ok({ created: res.created });
}

export async function deleteSuppression(pb: PocketBase, actor: Actor, id: string): Promise<WriteResult<void>> {
  const denied = suppressionGuard(actor);
  if (denied) return denied;
  if (!actor.roles.some((r) => r === 'admin' || r === 'incubator_lead')) return fail('FORBIDDEN', 'Bara ledningen kan ta bort en spärr.');
  const su = await getSuperuserPb();
  const res = await removeSuppression(su.ok ? su.pb : pb, actor.tenant, id);
  if (!res.ok) return fail('DB_ERROR', res.error);
  await logAgentAction(pb, { actor, action_type: 'update', collection: 'email_suppressions', record_id: id, after_value: { deleted: true } });
  return ok(undefined);
}

export interface SuppressionImportResult {
  added: number;
  existing: number;
  contactsUpdated: number;
  warnings: string[];
}

/**
 * Importerar en spärrlista (Mailchimps "unsubscribed"/"cleaned", § 55.2).
 * Varje adress spärras idempotent; kontakter med adressen får status.
 */
export async function importSuppressions(
  pb: PocketBase,
  actor: Actor,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  defaultReason: EmailSuppressionReason
): Promise<WriteResult<SuppressionImportResult>> {
  const denied = suppressionGuard(actor);
  if (denied) return denied;
  const parsed = parseSuppressionImport(headers, rows, defaultReason);
  if (parsed.rows.length === 0) return fail('INVALID_VALUE', parsed.warnings[0] ?? 'Filen innehöll inga adresser att spärra.');
  let added = 0;
  let existing = 0;
  let contactsUpdated = 0;
  const warnings = [...parsed.warnings];
  for (const r of parsed.rows) {
    const res = await addSuppression({
      tenant: actor.tenant,
      email: r.email,
      reason: r.reason === 'bounce' || r.reason === 'complaint' ? r.reason : 'import',
      source: 'mailchimp',
      note: r.note,
      createdBy: actor.id
    });
    if (!res.ok) {
      warnings.push(res.error);
      if (res.error.includes('migration')) break;
      continue;
    }
    if (res.created) added++;
    else existing++;
    contactsUpdated += res.contactsUpdated;
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'email_suppression_import',
    record_id: actor.tenant,
    after_value: { added, existing, contacts_updated: contactsUpdated, reason: parsed.detected.defaultReason }
  });
  return ok({ added, existing, contactsUpdated, warnings: warnings.slice(0, 50) });
}

/** Personalen registrerar ett samtycke till nyhetsbrev som givits på annat sätt (mässa, mejl). */
export async function setNewsletterConsent(pb: PocketBase, actor: Actor, contactId: string, consent: boolean): Promise<WriteResult<void>> {
  const denied = suppressionGuard(actor);
  if (denied) return denied;
  const contact = await getRecordInTenant<{ id: string; tenant?: string }>(pb, actor, 'contacts', contactId, 'id,tenant');
  if (!contact) return fail('NOT_FOUND', 'Kontakten hittades inte.');
  try {
    const row = await writeWithFallback(
      pb,
      (c) =>
        c.collection('contacts').update<Record<string, unknown>>(contact.id, {
          newsletter_consent: consent,
          newsletter_consent_at: consent ? new Date().toISOString() : null,
          newsletter_consent_source: consent ? 'staff' : ''
        }),
      { fallbackOn404: true }
    );
    if (!('newsletter_consent' in row)) return fail('DB_ERROR', CAMPAIGN_MIGRATION_HINT);
  } catch (err) {
    console.error('[campaigns] consent update failed', { status: statusOf(err) });
    return fail('DB_ERROR', 'Kunde inte spara samtycket.');
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: 'contacts', record_id: contact.id, field: 'newsletter_consent', after_value: { consent } });
  return ok(undefined);
}
