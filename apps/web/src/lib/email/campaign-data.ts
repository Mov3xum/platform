import 'server-only';
import type PocketBase from 'pocketbase';
import {
  isEmailCampaignStatus,
  isEmailCategory,
  isEmailConsentMode,
  normalizeEmailAudience,
  normalizeEmailBlocks,
  normalizeEmailDesign,
  type EmailAudience,
  type EmailBlock,
  type EmailCampaignStatus,
  type EmailCategory,
  type EmailConsentMode,
  type EmailDesign,
  type EmailRecipientStatus
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { isRuleDenialStatus } from '@/lib/read-scaling';

/**
 * Läsvägar för e-postkampanjer (CLAUDE.md § 54). Läser med användarens token
 * (RLS § 21) och faller tillbaka på superusern BARA vid PB v0.23.4:s tysta
 * regel-nekande (400/403/404) — aldrig på ett tomt resultat (en tom lista är
 * ett giltigt svar). Mottagarrader bär aldrig adresser, bara hash.
 */

export const CAMPAIGNS = 'email_campaigns';
export const CAMPAIGN_RECIPIENTS = 'email_campaign_recipients';
export const EMAIL_EVENTS = 'email_events';

export const CAMPAIGN_MIGRATION_HINT =
  'PocketBase saknar kampanjkollektionerna — kör migration 1700000201 (eller workflowen "Sync PocketBase").';

export interface CampaignRow {
  id: string;
  tenant: string;
  title: string;
  subject: string;
  preheader: string;
  category: EmailCategory;
  consent_mode: EmailConsentMode;
  status: EmailCampaignStatus;
  template_key: string;
  blocks: EmailBlock[];
  design: EmailDesign;
  audience: EmailAudience;
  sender_name: string;
  sender_user: string | null;
  event: string | null;
  /** Kopplad utvärdering (§ 47) — fyller {{utvärdering.länk}}. */
  survey: string | null;
  send_at: string | null;
  sent_at: string | null;
  send_base_url: string;
  recipients_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_count: number;
  bounced_count: number;
  complained_count: number;
  unsubscribed_count: number;
  clicked_count: number;
  link_clicks: { urls: string[]; counts: number[] };
  is_template: boolean;
  last_test_at: string | null;
  last_error: string;
  created_by: string | null;
  created: string;
  updated: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function normalizeCampaign(raw: Record<string, unknown>): CampaignRow {
  const lc = raw.link_clicks && typeof raw.link_clicks === 'object' ? (raw.link_clicks as { urls?: unknown; counts?: unknown }) : {};
  const urls = Array.isArray(lc.urls) ? lc.urls.filter((u): u is string => typeof u === 'string') : [];
  const counts = Array.isArray(lc.counts) ? lc.counts.map((c) => num(c)) : [];
  const category = isEmailCategory(raw.category) ? raw.category : 'other';
  return {
    id: str(raw.id),
    tenant: str(raw.tenant),
    title: str(raw.title),
    subject: str(raw.subject),
    preheader: str(raw.preheader),
    category,
    consent_mode: isEmailConsentMode(raw.consent_mode) ? raw.consent_mode : category === 'newsletter' ? 'consent_only' : 'legitimate_interest',
    status: isEmailCampaignStatus(raw.status) ? raw.status : 'draft',
    template_key: str(raw.template_key),
    blocks: normalizeEmailBlocks(raw.blocks),
    design: normalizeEmailDesign(raw.design),
    audience: normalizeEmailAudience(raw.audience),
    sender_name: str(raw.sender_name),
    sender_user: strOrNull(raw.sender_user),
    event: strOrNull(raw.event),
    survey: strOrNull(raw.survey),
    send_at: strOrNull(raw.send_at),
    sent_at: strOrNull(raw.sent_at),
    send_base_url: str(raw.send_base_url),
    recipients_count: num(raw.recipients_count),
    sent_count: num(raw.sent_count),
    failed_count: num(raw.failed_count),
    suppressed_count: num(raw.suppressed_count),
    bounced_count: num(raw.bounced_count),
    complained_count: num(raw.complained_count),
    unsubscribed_count: num(raw.unsubscribed_count),
    clicked_count: num(raw.clicked_count),
    link_clicks: { urls, counts: urls.map((_, i) => counts[i] ?? 0) },
    is_template: raw.is_template === true,
    last_test_at: strOrNull(raw.last_test_at),
    last_error: str(raw.last_error),
    created_by: strOrNull(raw.created_by),
    created: str(raw.created),
    updated: str(raw.updated)
  };
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

async function readWithFallback<T>(pb: PocketBase, run: (c: PocketBase) => Promise<T>): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    if (!isRuleDenialStatus(statusOf(err))) throw err;
    const su = await getSuperuserPb();
    if (!su.ok) throw err;
    return run(su.pb);
  }
}

export interface CampaignListResult {
  campaigns: CampaignRow[];
  templates: CampaignRow[];
  missing?: boolean;
  error?: string;
}

export async function listCampaigns(pb: PocketBase, tenant: string): Promise<CampaignListResult> {
  try {
    const rows = await readWithFallback(pb, (c) =>
      c.collection(CAMPAIGNS).getFullList<Record<string, unknown>>({
        filter: c.filter('tenant = {:t}', { t: tenant }),
        sort: '-updated',
        batch: 200
      })
    );
    const all = rows.map(normalizeCampaign);
    return { campaigns: all.filter((c) => !c.is_template), templates: all.filter((c) => c.is_template) };
  } catch (err) {
    if (statusOf(err) === 404) return { campaigns: [], templates: [], missing: true };
    return { campaigns: [], templates: [], error: 'Kunde inte läsa kampanjerna.' };
  }
}

/** En kampanj i tenanten — null när den inte finns eller tillhör någon annan. */
export async function getCampaign(pb: PocketBase, tenant: string, id: string): Promise<CampaignRow | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const raw = await readWithFallback(pb, (c) => c.collection(CAMPAIGNS).getOne<Record<string, unknown>>(id));
    const row = normalizeCampaign(raw);
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

export interface RecipientRow {
  id: string;
  campaign: string;
  contact: string | null;
  user: string | null;
  startup: string | null;
  signup: string | null;
  name: string;
  organization: string;
  email_hash: string;
  status: EmailRecipientStatus;
  sent_at: string | null;
  provider_message_id: string;
  click_count: number;
  first_clicked_at: string | null;
  fail_reason: string;
}

export function normalizeRecipient(raw: Record<string, unknown>): RecipientRow {
  const status = raw.status;
  return {
    id: str(raw.id),
    campaign: str(raw.campaign),
    contact: strOrNull(raw.contact),
    user: strOrNull(raw.user),
    startup: strOrNull(raw.startup),
    signup: strOrNull(raw.signup),
    name: str(raw.name),
    organization: str(raw.organization),
    email_hash: str(raw.email_hash),
    status: (typeof status === 'string' ? status : 'pending') as EmailRecipientStatus,
    sent_at: strOrNull(raw.sent_at),
    provider_message_id: str(raw.provider_message_id),
    click_count: num(raw.click_count),
    first_clicked_at: strOrNull(raw.first_clicked_at),
    fail_reason: str(raw.fail_reason)
  };
}

export async function listCampaignRecipients(pb: PocketBase, tenant: string, campaignId: string): Promise<RecipientRow[]> {
  try {
    const rows = await readWithFallback(pb, (c) =>
      c.collection(CAMPAIGN_RECIPIENTS).getFullList<Record<string, unknown>>({
        filter: c.filter('tenant = {:t} && campaign = {:c}', { t: tenant, c: campaignId }),
        sort: 'name',
        batch: 500
      })
    );
    return rows.map(normalizeRecipient);
  } catch {
    return [];
  }
}

export interface EmailEventRow {
  id: string;
  type: string;
  campaign: string | null;
  recipient: string | null;
  detail: string;
  at: string;
  created: string;
}

/** Händelser senaste N dagarna (för leveransstatistik på inställningssidan). */
export async function listRecentEmailEvents(pb: PocketBase, tenant: string, days: number): Promise<{ rows: EmailEventRow[]; error?: string }> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().replace('T', ' ');
  try {
    const rows = await readWithFallback(pb, (c) =>
      c.collection(EMAIL_EVENTS).getFullList<Record<string, unknown>>({
        filter: c.filter('tenant = {:t} && created >= {:s}', { t: tenant, s: since }),
        sort: '-created',
        fields: 'id,type,campaign,recipient,detail,at,created',
        batch: 500
      })
    );
    return {
      rows: rows.map((r) => ({
        id: str(r.id),
        type: str(r.type),
        campaign: strOrNull(r.campaign),
        recipient: strOrNull(r.recipient),
        detail: str(r.detail),
        at: str(r.at),
        created: str(r.created)
      }))
    };
  } catch (err) {
    if (statusOf(err) === 404) return { rows: [], error: CAMPAIGN_MIGRATION_HINT };
    return { rows: [], error: 'Kunde inte läsa leveranshändelserna.' };
  }
}
