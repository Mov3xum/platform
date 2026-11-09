import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import { listCampaigns, type CampaignRow } from '@/lib/email/campaign-data';
import {
  EMAIL_CAMPAIGN_STATUS_LABELS,
  EMAIL_CATEGORY_LABELS,
  deliverabilityHealth,
  emailCampaignRates,
  formatRate,
  formatStockholmDateTime,
  type EmailCampaignStatus
} from '@platform/shared';
import { buildInflodeTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

const STATUS_VARIANT: Record<EmailCampaignStatus, 'default' | 'draft' | 'active' | 'cyan' | 'copper'> = {
  draft: 'draft',
  scheduled: 'cyan',
  sending: 'cyan',
  sent: 'active',
  cancelled: 'default'
};

const HEALTH_TONE: Record<string, string> = {
  ok: 'var(--movexum-morkgron)',
  warn: 'var(--movexum-morkgul)',
  alert: 'var(--movexum-morkorange)',
  unknown: 'var(--color-foreground-subtle)'
};

function fmt(iso: string | null): string {
  return iso ? formatStockholmDateTime(iso) || iso : '';
}

function CampaignLine({ c }: { c: CampaignRow }) {
  const rates = emailCampaignRates(c);
  const health = deliverabilityHealth(rates);
  const when =
    c.status === 'sent' && c.sent_at
      ? `Skickad ${fmt(c.sent_at)}`
      : c.status === 'scheduled' && c.send_at
        ? `Skickas ${fmt(c.send_at)}`
        : c.status === 'sending'
          ? 'Skickas nu…'
          : `Ändrad ${fmt(c.updated)}`;
  return (
    <Link
      href={`/inflode/kampanjer/${c.id}`}
      className="mx-flex mx-items-c mx-gap-3"
      style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)', textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mx-fw-6 mx-t-14 mx-truncate">{c.title || c.subject || 'Namnlös kampanj'}</div>
        <div className="mx-t-xs mx-muted mx-truncate">
          {c.subject || <em>ingen ämnesrad</em>} · {EMAIL_CATEGORY_LABELS[c.category]} · {when}
        </div>
      </div>
      {c.status === 'sent' && (
        <div className="mx-t-xs mx-mono" style={{ textAlign: 'right', color: HEALTH_TONE[health] }} title="Skickade · studsar · klagomål · klick">
          {rates.sent} skickade
          <br />
          {formatRate(rates.bounceRate)} studs · {formatRate(rates.complaintRate, 2)} klagomål · {formatRate(rates.clickRate)} klick
        </div>
      )}
      {c.status !== 'sent' && c.audience.keys.length > 0 && (
        <span className="mx-t-xs mx-muted mx-mono">{c.audience.keys.length} mottagare</span>
      )}
      <Chip variant={STATUS_VARIANT[c.status]} mono>
        {EMAIL_CAMPAIGN_STATUS_LABELS[c.status]}
      </Chip>
    </Link>
  );
}

/**
 * Marknadsverktyg → Kampanjer (CLAUDE.md § 55). E-postutskick till
 * kontaktboken, bolag och personal: utkast, schemalagda och skickade med
 * leveransstatistik (studsar, klagomål, klick) direkt på raden, samt egna
 * sparade mallar. Läser med användarens token (RLS § 21); listan bär aldrig
 * e-postadresser.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ fel?: string }> }) {
  const { fel } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  const pb = await getServerPb();
  const res = await listCampaigns(pb, user.tenant);
  const active = res.campaigns.filter((c) => c.status !== 'sent' && c.status !== 'cancelled');
  const sent = res.campaigns.filter((c) => c.status === 'sent' || c.status === 'cancelled');

  return (
    <PageShell
      title="Kampanjer"
      tabs={buildInflodeTabs()}
      actions={
        <>
          <Link href="/installningar/e-post" className="mx-btn">
            <Icon name="gear" size={13} /> Leverans & spärrlista
          </Link>
          <Link href="/inflode/kampanjer/ny" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Ny kampanj
          </Link>
        </>
      }
    >
      <div className="space-y-4 py-4">
        {fel && (
          <div className="mx-t-13" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-orange)', color: 'var(--movexum-morkorange)' }}>
            {fel}
          </div>
        )}
        {res.missing && (
          <div className="mx-t-13" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-gul)', color: 'var(--movexum-morkgul)' }}>
            Kampanjkollektionen saknas i PocketBase — kör migration 1700000203 (eller &ldquo;Sync PocketBase&rdquo;).
          </div>
        )}
        {res.error && !res.missing && (
          <div className="mx-t-13" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-orange)', color: 'var(--movexum-morkorange)' }}>
            {res.error}
          </div>
        )}

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="mx-flex mx-items-c mx-justify-b" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
            <span className="mx-fw-6 mx-t-13">Utkast & schemalagda</span>
            <span className="mx-t-xs mx-muted">{active.length}</span>
          </div>
          {active.length === 0 ? (
            <p className="mx-t-13 mx-muted" style={{ padding: 16, margin: 0 }}>
              Inga pågående kampanjer. Skapa en från en mall — inbjudan, påminnelse, save the date, tack-mejl eller nyhetsbrev.
            </p>
          ) : (
            active.map((c) => <CampaignLine key={c.id} c={c} />)
          )}
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="mx-flex mx-items-c mx-justify-b" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
            <span className="mx-fw-6 mx-t-13">Skickade</span>
            <span className="mx-t-xs mx-muted">{sent.length}</span>
          </div>
          {sent.length === 0 ? (
            <p className="mx-t-13 mx-muted" style={{ padding: 16, margin: 0 }}>
              Inga skickade kampanjer än.
            </p>
          ) : (
            sent.map((c) => <CampaignLine key={c.id} c={c} />)
          )}
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="mx-flex mx-items-c mx-justify-b" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}>
            <span className="mx-fw-6 mx-t-13">Egna mallar</span>
            <span className="mx-t-xs mx-muted">{res.templates.length}</span>
          </div>
          {res.templates.length === 0 ? (
            <p className="mx-t-13 mx-muted" style={{ padding: 16, margin: 0 }}>
              Spara en kampanj som mall (&ldquo;Spara som mall&rdquo; i editorn) så ligger er egen struktur här. Movexums
              standardmallar finns alltid under &ldquo;Ny kampanj&rdquo;.
            </p>
          ) : (
            res.templates.map((t) => (
              <div
                key={t.id}
                className="mx-flex mx-items-c mx-gap-3"
                style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-fw-6 mx-t-14 mx-truncate">{t.title}</div>
                  <div className="mx-t-xs mx-muted mx-truncate">
                    {EMAIL_CATEGORY_LABELS[t.category]} · {t.blocks.length} block
                  </div>
                </div>
                <Link href={`/inflode/kampanjer/ny?from=${encodeURIComponent(t.id)}`} className="mx-btn mx-sm mx-primary">
                  Använd
                </Link>
                <Link href={`/inflode/kampanjer/${t.id}`} className="mx-btn mx-sm">
                  Redigera mall
                </Link>
              </div>
            ))
          )}
        </Card>
      </div>
    </PageShell>
  );
}
