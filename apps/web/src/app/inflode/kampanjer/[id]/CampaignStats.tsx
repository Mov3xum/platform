import Link from 'next/link';
import { Card, Chip, Icon } from '@/components/proto';
import type { CampaignRow, RecipientRow } from '@/lib/email/campaign-data';
import { DuplicateButton } from './DuplicateButton';
import { DeliverySyncButton } from './DeliverySyncButton';
import {
  EMAIL_CAMPAIGN_STATUS_LABELS,
  EMAIL_CATEGORY_LABELS,
  EMAIL_RECIPIENT_STATUSES,
  EMAIL_RECIPIENT_STATUS_LABELS,
  EMAIL_DELIVERY_STATUS_LABELS,
  deliverabilityHealth,
  deliveryStatusFromProviderEvent,
  emailCampaignRates,
  formatRate,
  formatStockholmDateTime,
  summarizeDeliveryStatuses,
  type EmailRecipientStatus
} from '@platform/shared';

const HEALTH_TEXT: Record<string, string> = {
  ok: 'Leveransen ser frisk ut.',
  warn: 'Studs- eller klagomålsnivån närmar sig gränsen — se över listan innan nästa utskick.',
  alert: 'Studs- eller klagomålsnivån är över Gmails tröskel. Rensa listan och skicka bara till dem som väntar sig mejlet.',
  unknown: 'Ingen leveransdata än.'
};
const HEALTH_TONE: Record<string, string> = {
  ok: 'var(--movexum-morkgron)',
  warn: 'var(--movexum-morkgul)',
  alert: 'var(--movexum-morkorange)',
  unknown: 'var(--color-foreground-subtle)'
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div className="mx-t-xs mx-muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div className="mx-disp mx-fw-6" style={{ fontSize: 22 }}>
        {value}
      </div>
      {hint && <div className="mx-t-xs mx-muted">{hint}</div>}
    </div>
  );
}

/** Statistikvyn för ett skickat utskick (§ 55.6). Inga e-postadresser — bara namn/organisation per status. */
export function CampaignStats({ campaign, recipients }: { campaign: CampaignRow; recipients: RecipientRow[] }) {
  const rates = emailCampaignRates(campaign);
  const health = deliverabilityHealth(rates);
  const byStatus = new Map<EmailRecipientStatus, RecipientRow[]>();
  for (const r of recipients) byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);
  const links = campaign.link_clicks.urls.map((url, i) => ({ url, count: campaign.link_clicks.counts[i] ?? 0 })).sort((a, b) => b.count - a.count);
  const clickers = recipients.filter((r) => r.click_count > 0).length;
  // Vad Resend säger hände EFTER att vi skickade (§ 55.4) — "Skickat" är bara mottaget hos Resend.
  const delivery = summarizeDeliveryStatuses(recipients);
  const deliveryLabel = (r: RecipientRow): string | null => {
    const d = deliveryStatusFromProviderEvent(r.delivery_status);
    return d ? EMAIL_DELIVERY_STATUS_LABELS[d] : null;
  };

  return (
    <div className="space-y-4 py-4">
      <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
        <Link href="/inflode/kampanjer" className="mx-btn mx-sm">
          <Icon name="back" size={12} /> Kampanjer
        </Link>
        <Chip mono>{EMAIL_CAMPAIGN_STATUS_LABELS[campaign.status]}</Chip>
        <span className="mx-t-xs mx-muted">
          {campaign.sent_at ? `Skickad ${formatStockholmDateTime(campaign.sent_at)}` : ''} · {EMAIL_CATEGORY_LABELS[campaign.category]}
          {campaign.sender_name ? ` · från ${campaign.sender_name}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <DuplicateButton id={campaign.id} />
      </div>
      {campaign.last_error && (
        <div className="mx-t-13" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-orange)', color: 'var(--movexum-morkorange)' }}>
          {campaign.last_error}
        </div>
      )}

      <Card style={{ padding: 16, borderLeft: `4px solid ${HEALTH_TONE[health]}` }}>
        <div className="mx-t-13 mx-fw-6" style={{ marginBottom: 12 }}>
          {campaign.subject}
        </div>
        <div className="mx-flex mx-gap-4" style={{ flexWrap: 'wrap' }}>
          <Stat label="Mottagare" value={campaign.recipients_count} hint={campaign.suppressed_count ? `${campaign.suppressed_count} spärrade hoppades över` : undefined} />
          <Stat label="Skickade" value={rates.sent} hint={campaign.failed_count ? `${campaign.failed_count} misslyckades` : undefined} />
          <Stat label="Levererade" value={rates.delivered} hint="skickade minus studsar" />
          <Stat label="Studsar" value={formatRate(rates.bounceRate)} hint={`${campaign.bounced_count} st · gräns 2 %`} />
          <Stat label="Klagomål" value={formatRate(rates.complaintRate, 2)} hint={`${campaign.complained_count} st · gräns 0,1 %`} />
          <Stat label="Klick" value={formatRate(rates.clickRate)} hint={`${clickers} personer klickade`} />
          <Stat label="Avregistreringar" value={formatRate(rates.unsubscribeRate)} hint={`${campaign.unsubscribed_count} st`} />
        </div>
        <p className="mx-t-13" style={{ margin: '12px 0 0', color: HEALTH_TONE[health] }}>
          {HEALTH_TEXT[health]} Öppningar mäts inte — vi använder ingen spårningspixel (§ 55.6).
        </p>
        {rates.sent > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--mx-line-soft)' }}>
            <div className="mx-t-13 mx-fw-6" style={{ marginBottom: 6 }}>
              Leveransstatus hos Resend
            </div>
            <p className="mx-t-xs mx-muted" style={{ margin: '0 0 8px' }}>
              {delivery.checked === 0
                ? '"Skickade" betyder att Resend tog emot mejlen. Hämta statusen för att se om de levererades till mottagarnas servrar.'
                : `${delivery.delivered} levererade · ${delivery.pending} väntar/köade hos Resend · ${delivery.bounced} studsade · ${delivery.complained} skräppost · ${delivery.failed} misslyckade${delivery.unchecked ? ` · ${delivery.unchecked} ej kontrollerade` : ''}.`}
            </p>
            <DeliverySyncButton id={campaign.id} unchecked={delivery.unchecked} />
          </div>
        )}
      </Card>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="mx-fw-6 mx-t-13" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
            Klick per länk
          </div>
          {links.length === 0 ? (
            <p className="mx-t-13 mx-muted" style={{ padding: 16, margin: 0 }}>
              Mejlet hade inga spårade länkar.
            </p>
          ) : (
            links.map((l, i) => (
              <div key={i} className="mx-flex mx-items-c mx-gap-3" style={{ padding: '8px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
                <span className="mx-t-13 mx-truncate" style={{ flex: 1, minWidth: 0 }} title={l.url}>
                  {l.url}
                </span>
                <span className="mx-mono mx-fw-6 mx-t-13">{l.count}</span>
              </div>
            ))
          )}
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="mx-fw-6 mx-t-13" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
            Mottagare per status
          </div>
          {recipients.length === 0 ? (
            <p className="mx-t-13 mx-muted" style={{ padding: 16, margin: 0 }}>
              Inga mottagarrader.
            </p>
          ) : (
            EMAIL_RECIPIENT_STATUSES.map((s) => {
              const rows = byStatus.get(s) ?? [];
              if (rows.length === 0) return null;
              return (
                <details key={s} style={{ borderBottom: '1px solid var(--mx-line-soft)' }}>
                  <summary className="mx-t-13 mx-flex mx-items-c mx-gap-2" style={{ padding: '8px 16px', cursor: 'pointer', listStyle: 'none' }}>
                    <span className="mx-fw-6">{EMAIL_RECIPIENT_STATUS_LABELS[s]}</span>
                    <span className="mx-mono mx-muted">{rows.length}</span>
                  </summary>
                  <ul className="mx-t-xs" style={{ margin: 0, padding: '0 16px 10px 32px' }}>
                    {rows.slice(0, 300).map((r) => (
                      <li key={r.id}>
                        {r.name || 'Okänd'}
                        {r.organization ? ` · ${r.organization}` : ''}
                        {r.click_count > 0 ? ` · ${r.click_count} klick` : ''}
                        {r.fail_reason ? ` · ${r.fail_reason}` : ''}
                        {deliveryLabel(r) ? ` · Resend: ${deliveryLabel(r)}` : ''}
                      </li>
                    ))}
                    {rows.length > 300 && <li className="mx-muted">+{rows.length - 300} till</li>}
                  </ul>
                </details>
              );
            })
          )}
        </Card>
      </div>
    </div>
  );
}
