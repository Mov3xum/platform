// Inflöde — översikt
// Hjärtat i inkubatorn: KPI-puls, funnel, source-attribution, modul-katalog,
// kampanjbrytning och de senaste leadsen.

import Link from 'next/link';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  PageHead,
  SectionHead,
  Card,
  Chip,
  Icon
} from '@/components/proto';
import {
  countLeadsByStatus,
  getLeadAnalytics,
  listLeads,
  listLeadSources,
  listModules
} from '@/lib/compass/store';
import {
  FLOW_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';

export const dynamic = 'force-dynamic';

const ANALYTICS_WINDOW_DAYS = 90;

export default async function InflödePage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  const pb = await getServerPb();
  const [statusCounts, recent, sources, modules, analytics] = await Promise.all([
    isStaff ? countLeadsByStatus(pb, user.tenant) : Promise.resolve(null),
    isStaff
      ? listLeads(pb, user.tenant, { perPage: 6 }).then((r) => r.items)
      : Promise.resolve([]),
    listLeadSources(pb),
    listModules(pb, user.tenant, { onlyActive: !isStaff }),
    isStaff ? getLeadAnalytics(pb, user.tenant, ANALYTICS_WINDOW_DAYS) : Promise.resolve(null)
  ]);

  const total = statusCounts
    ? LEAD_STATUS_ORDER.reduce((s, k) => s + (statusCounts[k] || 0), 0)
    : 0;
  const inFunnel = statusCounts
    ? (statusCounts.new || 0) +
      (statusCounts.contacted || 0) +
      (statusCounts['meeting-booked'] || 0) +
      (statusCounts.evaluating || 0)
    : 0;
  const conversionRate =
    statusCounts && total > 0
      ? Math.round((100 * (statusCounts.accepted || 0)) / total)
      : 0;

  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const moduleBySlug = new Map(modules.map((m) => [m.slug, m]));

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Inflöde"
        title="Inflöde"
        subtitle="Hjärtat i inkubatorn. Fånga, kvalificera och konvertera idéer till bolag. Deploya formulär, quiz och AI-chattar på egna URL:er och spåra var inflödet kommer ifrån."
        actions={
          <>
            <Link href="/inflode/chat" className="mx-btn">
              <Icon name="sparkle" size={13} /> Öppna AI-intag
            </Link>
            {isStaff && (
              <>
                <Link href="/inflode/leads/new" className="mx-btn">
                  <Icon name="plus" size={13} /> Nytt lead
                </Link>
                <Link href="/inflode/leads" className="mx-btn mx-primary">
                  <Icon name="people" size={13} /> Alla leads
                </Link>
              </>
            )}
          </>
        }
      />

      {/* Compliance-banner */}
      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted">
          <Icon name="shield" size={13} />
          <span>
            AI-intaget drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella
            anteckningar och personuppgifter exkluderas alltid från modellanrop.
            Riskklass: <strong>begränsad</strong> · Människan tar alltid det slutgiltiga beslutet.
          </span>
        </div>
      </Card>

      {/* KPI-strip */}
      {isStaff && statusCounts && analytics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 22
          }}
        >
          <KpiTile label="Totalt" value={total} hint="leads i inflöde" />
          <KpiTile label="I tratt" value={inFunnel} hint="ej beslutade" />
          <KpiTile
            label="Accepterade"
            value={statusCounts.accepted || 0}
            hint="redo att onboardas"
          />
          <KpiTile
            label="Konvertering"
            value={`${conversionRate}%`}
            hint="accept / totalt"
          />
          <KpiTile
            label="Konverterade bolag"
            value={analytics.converted}
            hint={`senaste ${ANALYTICS_WINDOW_DAYS} dagarna`}
          />
        </div>
      )}

      {/* Funnel */}
      {isStaff && statusCounts && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div
            className="mx-flex mx-items-c mx-gap-3"
            style={{ marginBottom: 10 }}
          >
            <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
              Funnel · klicka för att filtrera
            </span>
            <span className="mx-grow" />
            <span className="mx-mono mx-t-xs mx-muted">
              Antal per status
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 8
            }}
          >
            {LEAD_STATUS_ORDER.map((status) => {
              const n = statusCounts[status] || 0;
              const pct = total > 0 ? Math.round((100 * n) / total) : 0;
              return (
                <Link
                  key={status}
                  href={`/inflode/leads?status=${encodeURIComponent(status)}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 'var(--mx-r-md)',
                      background: 'var(--mx-paper-2)',
                      border: '1px solid var(--mx-line-soft)',
                      cursor: 'pointer'
                    }}
                  >
                    <div
                      className="mx-mono mx-t-xs mx-t-up mx-muted"
                      style={{ marginBottom: 4 }}
                    >
                      {LEAD_STATUS_LABEL[status]}
                    </div>
                    <div className="mx-disp" style={{ fontSize: 24, fontWeight: 600 }}>
                      {n}
                    </div>
                    <div className="mx-t-xs mx-muted">{pct}%</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* Var kommer leads ifrån + kampanjer (90 dagar) */}
      {isStaff && analytics && analytics.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22 }}>
          <Card style={{ padding: 16 }}>
            <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 12 }}>
              <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">Källor</span>
              <span className="mx-grow" />
              <span className="mx-mono mx-t-xs mx-muted">{ANALYTICS_WINDOW_DAYS} dagar</span>
            </div>
            {analytics.bySource.length === 0 ? (
              <div className="mx-muted mx-t-13">Inga leads i perioden.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {analytics.bySource.slice(0, 6).map((s) => {
                  const src = sourceByKey.get(s.source_key);
                  const pct = analytics.total > 0 ? Math.round((100 * s.total) / analytics.total) : 0;
                  const convPct = s.total > 0 ? Math.round((100 * s.accepted) / s.total) : 0;
                  return (
                    <Link
                      key={s.source_key}
                      href={`/inflode/leads?src=${encodeURIComponent(s.source_key)}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div
                        className="mx-flex mx-items-c mx-gap-2"
                        style={{ padding: '6px 0' }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 2,
                            background: src?.color || '#002c40',
                            flexShrink: 0
                          }}
                        />
                        <span className="mx-t-13 mx-fw-6" style={{ minWidth: 110 }}>
                          {src?.label || s.source_key}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            background: 'var(--mx-line-soft)',
                            borderRadius: 3,
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: src?.color || '#002c40'
                            }}
                          />
                        </div>
                        <span className="mx-mono mx-t-xs mx-fw-6" style={{ minWidth: 32, textAlign: 'right' }}>
                          {s.total}
                        </span>
                        <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 48, textAlign: 'right' }}>
                          {convPct}% konv
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          <Card style={{ padding: 16 }}>
            <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 12 }}>
              <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">Kampanjer · UTM</span>
              <span className="mx-grow" />
              <span className="mx-mono mx-t-xs mx-muted">{analytics.byCampaign.length} aktiva</span>
            </div>
            {analytics.byCampaign.length === 0 ? (
              <div className="mx-muted mx-t-13">
                Inga UTM-spårade leads ännu. Lägg <code className="mx-mono">?utm_source=...&amp;utm_campaign=...</code> på modul-URL:er för att mäta kampanjer.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {analytics.byCampaign.slice(0, 6).map((c) => (
                  <div
                    key={c.campaign}
                    className="mx-flex mx-items-c mx-gap-2"
                    style={{ padding: '4px 0' }}
                  >
                    <span className="mx-t-13 mx-fw-6 mx-truncate" style={{ flex: 1, minWidth: 0 }}>
                      {c.campaign}
                    </span>
                    {c.source && (
                      <Chip variant="cyan" mono>
                        {c.source}
                      </Chip>
                    )}
                    <span className="mx-mono mx-t-xs mx-fw-6" style={{ minWidth: 32, textAlign: 'right' }}>
                      {c.total}
                    </span>
                    <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 64, textAlign: 'right' }}>
                      {c.accepted} accept.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Modul-katalog */}
      <SectionHead
        title="Intag-flöden"
        label={`${modules.length} ${modules.length === 1 ? 'modul' : 'moduler'} · publicerade på egna URL:er`}
        right={
          isStaff ? (
            <Link href="/inflode/admin/modules" className="mx-btn mx-sm">
              <Icon name="gear" size={12} /> Hantera moduler
            </Link>
          ) : null
        }
      />
      {modules.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center', marginBottom: 22 }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 16, marginBottom: 6 }}>
            Inga intag-moduler publicerade
          </div>
          <div className="mx-muted mx-t-13" style={{ marginBottom: 16 }}>
            {isStaff
              ? 'Skapa en modul (formulär, quiz eller AI-chatt) för att börja samla in leads från event, webb eller kampanjer.'
              : 'Be inkubatorteamet aktivera ett intag-flöde.'}
          </div>
          {isStaff && (
            <Link href="/inflode/admin/modules/new" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa modul
            </Link>
          )}
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            marginBottom: 22
          }}
        >
          {modules.map((m) => {
            const isChat = m.flow_type === 'chat';
            const metrics = analytics?.byModule.find((x) => x.slug === m.slug);
            return (
              <Card
                key={m.id}
                ink={isChat}
                style={{
                  padding: 16,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Chip variant={isChat ? 'cyan' : 'default'} mono>
                    {FLOW_TYPE_LABEL[m.flow_type].toUpperCase()}
                  </Chip>
                  {m.public_url_enabled && (
                    <Chip variant="active" mono>
                      PUBLIK
                    </Chip>
                  )}
                  <span className="mx-grow" />
                  {!m.is_active && (
                    <Chip variant="draft" mono>
                      UTKAST
                    </Chip>
                  )}
                </div>
                <div className="mx-disp" style={{ fontSize: 18, fontWeight: 600 }}>
                  {m.name}
                </div>
                <div className="mx-t-13 mx-muted" style={{ lineHeight: 1.4 }}>
                  {m.description || 'Starta modulen för att beskriva idén och få nästa steg.'}
                </div>
                <div className="mx-grow" />
                {isStaff && metrics && (
                  <div className="mx-flex mx-items-c mx-gap-2 mx-mono mx-t-xs mx-muted">
                    <span className="mx-fw-6 mx-ink-soft">{metrics.total}</span> leads
                    <span>·</span>
                    <span className="mx-fw-6 mx-ink-soft">{metrics.accepted}</span> accept.
                    <span>·</span>
                    <span className="mx-fw-6 mx-ink-soft">{metrics.converted}</span> bolag
                  </div>
                )}
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Link href={`/inflode/m/${m.slug}`} className="mx-btn mx-sm">
                    Starta →
                  </Link>
                  {isStaff && (
                    <Link
                      href={`/inflode/admin/modules/${m.slug}`}
                      className="mx-btn mx-sm mx-ghost"
                    >
                      <Icon name="gear" size={12} /> Redigera
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Senaste leads */}
      {isStaff && (
        <>
          <SectionHead
            title="Senaste leads"
            label={recent.length === 0 ? 'inga ännu' : `${recent.length} senaste`}
            right={
              <Link href="/inflode/leads" className="mx-btn mx-sm">
                Visa alla →
              </Link>
            }
          />
          {recent.length === 0 ? (
            <Card style={{ padding: 24, textAlign: 'center' }}>
              <div className="mx-muted mx-t-13">
                Inga leads har skapats ännu. Aktivera en intag-modul eller skapa ett lead manuellt.
              </div>
            </Card>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {recent.map((lead) => {
                const source = sourceByKey.get(lead.source_key);
                const landingMod = lead.landing_module
                  ? moduleBySlug.get(lead.landing_module)
                  : undefined;
                return (
                  <Link
                    key={lead.id}
                    href={`/inflode/leads/${lead.id}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mx-flex mx-items-c mx-gap-2">
                          <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">
                            {lead.name || 'Anonym'}
                          </span>
                          <Chip variant={statusChipVariant(lead.status)} mono>
                            {LEAD_STATUS_LABEL[lead.status]}
                          </Chip>
                          {lead.converted_startup && (
                            <Chip variant="active" mono>
                              KONVERTERAT
                            </Chip>
                          )}
                        </div>
                        <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                          {lead.idea_summary || lead.email || lead.organization || '—'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="mx-mono mx-t-xs mx-muted mx-t-up">
                          {source?.label || lead.source_key}
                          {landingMod && ` · ${landingMod.name}`}
                          {lead.utm_campaign && ` · ${lead.utm_campaign}`}
                        </div>
                        {typeof lead.score === 'number' && (
                          <div className="mx-mono mx-t-xs mx-fw-6" style={{ marginTop: 2 }}>
                            {lead.score} p
                          </div>
                        )}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      <div
        className="mx-mt-6 mx-muted mx-t-xs mx-mono"
        style={{ textAlign: 'center', marginTop: 32 }}
      >
        Genererat av AI – verifiera innan delning. Konfidentiella anteckningar exkluderas
        alltid från Mistral-anrop.
      </div>
    </div>
  );
}

function statusChipVariant(status: LeadStatus): React.ComponentProps<typeof Chip>['variant'] {
  switch (status) {
    case 'new':
      return 'draft';
    case 'contacted':
    case 'meeting-booked':
      return 'review';
    case 'evaluating':
      return 'cyan';
    case 'accepted':
      return 'active';
    case 'declined':
      return 'archive';
    default:
      return 'default';
  }
}

function KpiTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card style={{ padding: 16 }}>
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{label}</div>
      <div
        className="mx-disp"
        style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.1, marginTop: 4 }}
      >
        {value}
      </div>
      {hint && (
        <div className="mx-t-xs mx-muted" style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
    </Card>
  );
}
