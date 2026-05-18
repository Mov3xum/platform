import 'server-only';
import type { NormalizedRecord } from '../../types';
import type { BrevoCampaign, BrevoList } from './client';

// Brevo → NormalizedRecord mappers. Payloads are strictly
// whitelisted aggregate metrics — no individual contact emails or
// names leave Brevo (CLAUDE.md § 9.3 + § 10.2 GDPR § 5
// data-minimisation).

export function normalizeList(list: BrevoList): NormalizedRecord {
  return {
    externalId: String(list.id),
    recordType: 'audience',
    title: list.name,
    summary: `${list.totalSubscribers ?? 0} kontakter`,
    url: `https://app.brevo.com/contact/list/id/${list.id}`,
    occurredAt: list.createdAt || new Date().toISOString(),
    payload: {
      totalSubscribers: list.totalSubscribers ?? 0,
      totalBlacklisted: list.totalBlacklisted ?? 0
    }
  };
}

export function normalizeCampaign(campaign: BrevoCampaign): NormalizedRecord {
  const stats = campaign.statistics?.globalStats || {};
  const sent = stats.sent ?? 0;
  const uniqueViews = stats.uniqueViews ?? 0;
  const uniqueClicks = stats.uniqueClicks ?? 0;
  const openRate = sent > 0 ? Math.round((uniqueViews / sent) * 1000) / 10 : 0;
  const clickRate = sent > 0 ? Math.round((uniqueClicks / sent) * 1000) / 10 : 0;
  const occurred =
    campaign.sentDate || campaign.modifiedAt || campaign.createdAt || new Date().toISOString();

  return {
    externalId: String(campaign.id),
    recordType: 'campaign',
    title: campaign.name,
    summary: `Skickade ${sent} · ${openRate}% öppningar · ${clickRate}% klick`,
    url: `https://app.brevo.com/camp/dashboard/${campaign.id}`,
    occurredAt: occurred,
    payload: {
      subject: campaign.subject || '',
      status: campaign.status || '',
      sent,
      delivered: stats.delivered ?? 0,
      uniqueViews,
      uniqueClicks,
      hardBounces: stats.hardBounces ?? 0,
      softBounces: stats.softBounces ?? 0,
      unsubscriptions: stats.unsubscriptions ?? 0,
      openRatePct: openRate,
      clickRatePct: clickRate
    }
  };
}
