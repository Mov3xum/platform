// Startupkompassen — översikt
// Ersätter den tidigare Sprint X-portföljvyn med ett Compass-inspirerat
// nav-hub: KPI-strip, funnel, senaste leads och snabbingångar till
// chat/wizard/admin.

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
  listLeads,
  listLeadSources,
  listModules
} from '@/lib/compass/store';
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER, type LeadStatus } from '@/lib/compass/types';

export const dynamic = 'force-dynamic';

export default async function KompassenPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  // Endast staff har full åtkomst till lead-data. Övriga roller får
  // se modul-katalogen och kan starta intake-flöden.
  const pb = await getServerPb();
  const [statusCounts, recent, sources, modules] = await Promise.all([
    isStaff ? countLeadsByStatus(pb, user.tenant) : Promise.resolve(null),
    isStaff
      ? listLeads(pb, user.tenant, { perPage: 6 }).then((r) => r.items)
      : Promise.resolve([]),
    listLeadSources(pb),
    listModules(pb, user.tenant, { onlyActive: !isStaff })
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

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Startupkompassen"
        title="Startupkompassen"
        subtitle="Regionens kompass för idébärare. Fånga, kvalificera och matcha leads från event, webb och AI-intag."
        actions={
          <>
            <Link href="/kompassen/chat" className="mx-btn">
              <Icon name="sparkle" size={13} /> Öppna AI-intag
            </Link>
            {isStaff && (
              <Link href="/kompassen/leads" className="mx-btn mx-primary">
                <Icon name="people" size={13} /> Alla leads
              </Link>
            )}
          </>
        }
      />

      {/* Banner — Mistral / EU-suveränt enligt CLAUDE.md §9.7 */}
      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted">
          <Icon name="shield" size={13} />
          <span>
            AI-intaget drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella
            anteckningar och personuppgifter exkluderas alltid från modellanrop.
          </span>
        </div>
      </Card>

      {/* KPI-strip — bara staff ser leads-volymer */}
      {isStaff && statusCounts && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 22
          }}
        >
          <KpiTile label="Totalt" value={total} hint="leads i kompassen" />
          <KpiTile label="I tratt" value={inFunnel} hint="ej beslutade" />
          <KpiTile label="Accepterade" value={statusCounts.accepted || 0} hint="onboardas till plattformen" />
          <KpiTile label="Konvertering" value={`${conversionRate}%`} hint="accept / totalt" />
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
              Funnel
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
                  href={`/kompassen/leads?status=${encodeURIComponent(status)}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 'var(--mx-r-md)',
                      background: 'var(--mx-paper-2)',
                      border: '1px solid var(--mx-line-soft)',
                      cursor: 'pointer',
                      transition: 'background 120ms ease'
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

      {/* Modul-katalog — alla användare ser de aktiva */}
      <SectionHead
        title="Intag-flöden"
        label={`${modules.length} ${modules.length === 1 ? 'modul' : 'moduler'}`}
        right={
          isStaff ? (
            <Link href="/kompassen/admin/modules" className="mx-btn mx-sm">
              <Icon name="gear" size={12} /> Hantera
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
              ? 'Skapa er första modul för att börja samla in leads från event, webb eller AI-chat.'
              : 'Be inkubatorteamet aktivera ett intag-flöde.'}
          </div>
          {isStaff && (
            <Link href="/kompassen/admin/modules" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa modul
            </Link>
          )}
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
            marginBottom: 22
          }}
        >
          {modules.map((m) => {
            const isChat = m.flow_type === 'chat';
            return (
              <Link
                key={m.id}
                href={`/kompassen/m/${m.slug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card
                  ink={isChat}
                  className="mx-hover-card"
                  style={{
                    padding: 16,
                    cursor: 'pointer',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <Chip variant={isChat ? 'cyan' : 'default'} mono>
                      {isChat ? 'AI-CHAT' : m.flow_type.toUpperCase()}
                    </Chip>
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
                  <div className="mx-mono mx-t-xs mx-fw-6">
                    Starta {m.name} →
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Senaste leads — staff */}
      {isStaff && (
        <>
          <SectionHead
            title="Senaste leads"
            label={recent.length === 0 ? 'inga ännu' : `${recent.length} senaste`}
            right={
              <Link href="/kompassen/leads" className="mx-btn mx-sm">
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
                return (
                  <Link
                    key={lead.id}
                    href={`/kompassen/leads/${lead.id}`}
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
                        </div>
                        <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                          {lead.idea_summary || lead.email || lead.organization || '—'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="mx-mono mx-t-xs mx-muted mx-t-up">
                          {source?.label || lead.source_key}
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
