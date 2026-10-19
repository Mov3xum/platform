import 'server-only';
import type PocketBase from 'pocketbase';
import {
  emailEventTypeFromProvider,
  isHardBounce,
  normalizeEmailAddress,
  type EmailEventType,
  type EmailSuppressionReason
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { CAMPAIGNS, CAMPAIGN_RECIPIENTS, EMAIL_EVENTS } from './campaign-data';
import { hashEmail } from './signed-tokens';
import { addSuppression } from './suppression';

/**
 * Behandlar en VERIFIERAD webhook-händelse från Resend (CLAUDE.md § 54.1).
 *
 *   email.delivered        → mottagarraden får `delivered`-händelse
 *   email.bounced          → hård studs: spärra adressen + kontaktstatus;
 *                            mjuk studs: bara händelse (ingen spärr)
 *   email.complained       → spärra + kontaktstatus `complained` + opt-out
 *   email.delivery_delayed → bara händelse
 *
 * Mottagarraden hittas på leverantörens meddelande-id (sparat vid utskick);
 * saknas det matchas adressens hash mot kampanjrader de senaste 30 dagarna.
 * Tenant tas ur raden eller ur taggen `tenant` på mejlet (vi sätter den på
 * varje kampanjmejl); utan tenant spärras adressen i varje tenant där den är
 * kontakt. Allt körs med superusern; payloaden är DATA (aldrig loggad rått).
 */

export interface ProviderEvent {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    tags?: unknown;
    bounce?: unknown;
    created_at?: unknown;
  };
}

export interface WebhookOutcome {
  handled: boolean;
  type: EmailEventType | null;
  matchedRecipient: boolean;
  suppressed: boolean;
}

function tagValue(tags: unknown, name: string): string {
  if (Array.isArray(tags)) {
    const hit = tags.find((t) => t && typeof t === 'object' && (t as { name?: unknown }).name === name);
    const v = hit ? (hit as { value?: unknown }).value : undefined;
    return typeof v === 'string' ? v : '';
  }
  if (tags && typeof tags === 'object') {
    const v = (tags as Record<string, unknown>)[name];
    return typeof v === 'string' ? v : '';
  }
  return '';
}

function firstEmail(to: unknown): string | null {
  const raw = Array.isArray(to) ? to[0] : to;
  return normalizeEmailAddress(typeof raw === 'string' ? raw : null);
}

interface RecipientHit {
  id: string;
  tenant: string;
  campaign: string;
  status: string;
}

async function findRecipient(pb: PocketBase, messageId: string, hash: string | null, tenantHint: string): Promise<RecipientHit | null> {
  try {
    if (messageId) {
      const list = await pb.collection(CAMPAIGN_RECIPIENTS).getList<RecipientHit>(1, 1, {
        filter: pb.filter('provider_message_id = {:m}', { m: messageId }),
        fields: 'id,tenant,campaign,status'
      });
      if (list.items[0]) return list.items[0];
    }
    if (hash) {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ');
      const filter = tenantHint
        ? pb.filter('tenant = {:t} && email_hash = {:h} && sent_at >= {:s}', { t: tenantHint, h: hash, s: since })
        : pb.filter('email_hash = {:h} && sent_at >= {:s}', { h: hash, s: since });
      const list = await pb.collection(CAMPAIGN_RECIPIENTS).getList<RecipientHit>(1, 1, {
        filter,
        sort: '-sent_at',
        fields: 'id,tenant,campaign,status'
      });
      if (list.items[0]) return list.items[0];
    }
  } catch (err) {
    console.error('[email-webhook] recipient lookup failed', { status: (err as { status?: number })?.status });
  }
  return null;
}

async function bump(pb: PocketBase, campaignId: string, field: 'bounced_count' | 'complained_count'): Promise<void> {
  try {
    const c = await pb.collection(CAMPAIGNS).getOne<Record<string, unknown>>(campaignId, { fields: `id,${field}` });
    const cur = typeof c[field] === 'number' ? (c[field] as number) : 0;
    await pb.collection(CAMPAIGNS).update(campaignId, { [field]: cur + 1 });
  } catch {
    /* räknaren är en cache */
  }
}

/** Tenants där adressen är kontakt (när mejlet saknar tenant-tagg). */
async function tenantsWithContact(pb: PocketBase, email: string): Promise<string[]> {
  try {
    const rows = await pb.collection('contacts').getFullList<{ tenant?: string }>({
      filter: pb.filter('email = {:e}', { e: email }),
      fields: 'tenant'
    });
    return [...new Set(rows.map((r) => r.tenant).filter((t): t is string => Boolean(t)))];
  } catch {
    return [];
  }
}

export async function handleProviderEvent(event: ProviderEvent): Promise<WebhookOutcome> {
  const type = emailEventTypeFromProvider(event.type);
  if (!type) return { handled: false, type: null, matchedRecipient: false, suppressed: false };
  const su = await getSuperuserPb();
  if (!su.ok) throw new Error('superuser_missing');
  const pb = su.pb;
  const data = event.data ?? {};
  const messageId = typeof data.email_id === 'string' ? data.email_id.slice(0, 100) : '';
  const email = firstEmail(data.to);
  const hash = email ? hashEmail(email) : null;
  const tenantHint = tagValue(data.tags, 'tenant').slice(0, 64);
  const hit = await findRecipient(pb, messageId, hash, tenantHint);
  const tenant = hit?.tenant || tenantHint;
  const at = typeof data.created_at === 'string' ? data.created_at : typeof event.created_at === 'string' ? event.created_at : new Date().toISOString();

  let suppressed = false;
  let detail = '';
  let reason: EmailSuppressionReason | null = null;
  if (type === 'bounced') {
    const hard = isHardBounce(data.bounce);
    const b = data.bounce as { type?: unknown; subType?: unknown } | undefined;
    detail = [typeof b?.type === 'string' ? b.type : '', typeof b?.subType === 'string' ? b.subType : ''].filter(Boolean).join('/');
    if (hard) reason = 'bounce';
  } else if (type === 'complained') {
    reason = 'complaint';
  }

  if (reason && email) {
    const targets = tenant ? [tenant] : await tenantsWithContact(pb, email);
    for (const t of targets) {
      const res = await addSuppression({ tenant: t, email, reason, source: 'resend', note: detail.slice(0, 200) });
      if (res.ok) suppressed = true;
    }
  }

  if (hit) {
    const newStatus = type === 'bounced' && reason ? 'bounced' : type === 'complained' ? 'complained' : null;
    if (newStatus && hit.status !== newStatus) {
      await pb.collection(CAMPAIGN_RECIPIENTS).update(hit.id, { status: newStatus, fail_reason: detail.slice(0, 300) }).catch(() => undefined);
      await bump(pb, hit.campaign, newStatus === 'bounced' ? 'bounced_count' : 'complained_count');
    }
  }

  try {
    await pb.collection(EMAIL_EVENTS).create({
      ...(tenant ? { tenant } : {}),
      type,
      ...(hit ? { campaign: hit.campaign, recipient: hit.id } : {}),
      provider_message_id: messageId,
      detail: detail.slice(0, 200),
      at
    });
  } catch (err) {
    console.error('[email-webhook] event log failed', { status: (err as { status?: number })?.status });
  }
  return { handled: true, type, matchedRecipient: Boolean(hit), suppressed };
}
