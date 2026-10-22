import 'server-only';
import type PocketBase from 'pocketbase';
import { deliveryStatusFromProviderEvent, isFinalDeliveryStatus, normalizeEmailAddress, type EmailDeliveryStatus } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { CAMPAIGN_RECIPIENTS, EMAIL_EVENTS, getCampaign } from './campaign-data';
import { retrieveEmail } from './send-batch';
import { addSuppression } from './suppression';
import { bumpCampaignCounter } from './webhook-handler';

/**
 * Leveransstatus från Resend (CLAUDE.md § 55.4). "Skickat" betyder bara att
 * Resend tog emot mejlet; här hämtas vad som hände sedan (`GET /emails/{id}`
 * → `last_event`) för varje skickad mottagarrad som ännu saknar slutlig
 * status, och skrivs på raden. En studs eller ett klagomål hanteras som
 * webhooken gör: raden får status, adressen spärras (läses transient ur
 * Resends svar, lagras aldrig) och kampanjens räknare uppdateras.
 *
 * Resends standardgräns är 2 anrop/s och ett klick ska svara inom rimlig
 * tid — därför ett tak per körning (`MAX_PER_RUN`); knappen körs igen för
 * resten. Körs med superusern EFTER att anroparen verifierat roll + tenant.
 */

const MAX_PER_RUN = 60;
const PAUSE_MS = 550;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DeliverySyncResult {
  checked: number;
  delivered: number;
  bounced: number;
  complained: number;
  pending: number;
  failed: number;
  /** Rader som väntar på nästa körning (taket per klick nått). */
  remaining: number;
  /** Första felet från Resend (PII-fritt). */
  error?: string;
  /** Schemat saknar fälten (migration 1700000205) — statusen kunde inte sparas. */
  schemaMissing?: boolean;
}

interface Row {
  id: string;
  status: string;
  provider_message_id?: string;
  delivery_status?: string;
}

export async function syncCampaignDelivery(pb: PocketBase, tenant: string, campaignId: string): Promise<DeliverySyncResult | { error: string }> {
  const campaign = await getCampaign(pb, tenant, campaignId);
  if (!campaign) return { error: 'Utskicket hittades inte.' };
  const su = await getSuperuserPb();
  if (!su.ok) return { error: 'Leveransstatus kräver superuser-inloggning på web-appen (POCKETBASE_SUPERUSER_EMAIL/PASSWORD).' };
  const client = su.pb;

  let rows: Row[];
  try {
    rows = await client.collection(CAMPAIGN_RECIPIENTS).getFullList<Row>({
      filter: client.filter('tenant = {:t} && campaign = {:c} && provider_message_id != ""', { t: tenant, c: campaign.id }),
      fields: 'id,status,provider_message_id,delivery_status',
      batch: 500
    });
  } catch (err) {
    console.error('[campaigns] delivery rows failed', { status: (err as { status?: number })?.status });
    return { error: 'Kunde inte läsa mottagarraderna.' };
  }
  const todo = rows.filter((r) => r.provider_message_id && !isFinalDeliveryStatus(deliveryStatusFromProviderEvent(r.delivery_status)));
  const batch = todo.slice(0, MAX_PER_RUN);
  const out: DeliverySyncResult = { checked: 0, delivered: 0, bounced: 0, complained: 0, pending: 0, failed: 0, remaining: Math.max(todo.length - batch.length, 0) };
  const now = new Date().toISOString();

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i]!;
    if (i > 0) await sleep(PAUSE_MS);
    const res = await retrieveEmail(r.provider_message_id!);
    if ('error' in res) {
      out.error ??= res.error;
      // En nyckel som avvisas gäller alla — sluta hamra på Resend.
      if (/API-nyckeln|RESEND_API_KEY/.test(res.error)) break;
      continue;
    }
    const status: EmailDeliveryStatus = deliveryStatusFromProviderEvent(res.lastEvent) ?? 'sent';
    out.checked++;
    if (status === 'delivered') out.delivered++;
    else if (status === 'bounced') out.bounced++;
    else if (status === 'complained') out.complained++;
    else if (status === 'failed' || status === 'canceled') out.failed++;
    else out.pending++;

    const patch: Record<string, unknown> = { delivery_status: status, delivery_checked_at: now };
    const rowStatus = status === 'bounced' ? 'bounced' : status === 'complained' ? 'complained' : null;
    if (rowStatus && r.status !== rowStatus) {
      patch.status = rowStatus;
      patch.fail_reason = status === 'bounced' ? 'Studsade enligt Resend' : 'Markerat som skräppost enligt Resend';
      await bumpCampaignCounter(client, campaign.id, rowStatus === 'bounced' ? 'bounced_count' : 'complained_count');
      const email = normalizeEmailAddress(res.to);
      if (email) {
        await addSuppression({ tenant, email, reason: rowStatus === 'bounced' ? 'bounce' : 'complaint', source: 'resend_status', note: `Hämtat från Resend (${res.lastEvent})`.slice(0, 200) }).catch(
          () => undefined
        );
      }
      await client
        .collection(EMAIL_EVENTS)
        .create({ tenant, type: rowStatus, campaign: campaign.id, recipient: r.id, provider_message_id: r.provider_message_id, detail: 'Hämtat från Resend', at: now })
        .catch(() => undefined);
    }
    try {
      const saved = await client.collection(CAMPAIGN_RECIPIENTS).update<Record<string, unknown>>(r.id, patch);
      // PB släpper okända fält tyst (§ 24.4) — säg att migrationen saknas i stället för en tyst no-op.
      if (typeof saved.delivery_status !== 'string' || !saved.delivery_status) out.schemaMissing = true;
    } catch (err) {
      console.error('[campaigns] delivery row update failed', { status: (err as { status?: number })?.status });
    }
  }
  return out;
}
