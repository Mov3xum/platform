// Inflöde — översikt

import Link from 'next/link';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { Chip, Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat } from '@/components/PageRail';
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
    statusCounts && total > 0 ? Math.round((100 * (statusCounts.accepted || 0)) / total) : 0;

  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const moduleBySlug = new Map(modules.map((m) => [m.slug, m]));

  const rail = (
    <>
      {isStaff && statusCounts && (
        <RailSection label="Pipeline">
          <div className="grid grid-cols-2 gap-2 px-2">
            <RailStat label="Totalt" value={total} />
            <RailStat label="I tratt" value={inFunnel} />
            <RailStat label="Accepterade" value={statusCounts.accepted || 0} />
            <RailStat label="Konvertering" value={`${conversionRate}%`} />
          </div>
        </RailSection>
      )}

      {isStaff && analytics && analytics.bySource.length > 0 && (
        <RailSection label={`Källor · ${ANALYTICS_WINDOW_DAYS} dgr`}>
          {analytics.bySource.slice(0, 6).map((s) => {
            const src = sourceByKey.get(s.source_key);
            const convPct = s.total > 0 ? Math.round((100 * s.accepted) / s.total) : 0;
            return (
              <Link
                key={s.source_key}
                href={`/inflode/leads?src=${encodeURIComponent(s.source_key)}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-muted"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: src?.color || '#002c40' }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {src?.label || s.source_key}
                </span>
                <span className="font-mono text-[11px] text-foreground">{s.total}</span>
                <span className="font-mono text-[10.5px] text-foreground-subtle">
                  {convPct}%
                </span>
              </Link>
            );
          })}
        </RailSection>
      )}

      <RailSection label="Moduler">
        {modules.length === 0 ? (
          <div className="px-2 py-4 text-center text-[12px] text-foreground-subtle">
            Inga publicerade moduler.
          </div>
        ) : (
          modules.slice(0, 5).map((m) => (
            <RailItem
              key={m.id}
              icon={m.flow_type === 'chat' ? 'sparkle' : 'doc'}
              iconTone={m.flow_type === 'chat' ? 'accent' : 'brand'}
              title={m.name}
              meta={FLOW_TYPE_LABEL[m.flow_type]}
              href={`/inflode/m/${m.slug}`}
            />
          ))
        )}
      </RailSection>
    </>
  );

  const actions = (
    <>
      <Link
        href="/inflode/chat"
        className="inline-flex items-center gap-1.5 rounded-lg border border-default bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:bg-canvas-muted"
      >
        Öppna intag
      </Link>
      {isStaff && (
        <Link
          href="/inflode/leads"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
        >
          <Icon name="people" size={12} /> Alla leads
        </Link>
      )}
    </>
  );

  return (
    <PageShell title="Inflöde" actions={actions} rightPanel={rail}>
      <div className="space-y-6 py-6">
        {isStaff && statusCounts && (
          <section className="rounded-2xl border border-default bg-surface">
            <div className="flex items-center justify-between border-b border-default px-5 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Funnel · klicka för att filtrera
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-6">
              {LEAD_STATUS_ORDER.map((status) => {
                const n = statusCounts[status] || 0;
                const pct = total > 0 ? Math.round((100 * n) / total) : 0;
                return (
                  <Link
                    key={status}
                    href={`/inflode/leads?status=${encodeURIComponent(status)}`}
                    className="rounded-xl border border-default bg-canvas-subtle px-3 py-3 transition hover:border-strong"
                  >
                    <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-foreground-subtle">
                      {LEAD_STATUS_LABEL[status]}
                    </div>
                    <div className="text-2xl font-semibold text-foreground tabular-nums">{n}</div>
                    <div className="text-[11px] text-foreground-subtle">{pct}%</div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {isStaff && analytics && analytics.byCampaign.length > 0 && (
          <section className="rounded-2xl border border-default bg-surface">
            <div className="flex items-center justify-between border-b border-default px-5 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Kampanjer · UTM
              </span>
              <span className="font-mono text-[11px] text-foreground-subtle">
                {analytics.byCampaign.length} aktiva
              </span>
            </div>
            <div className="space-y-1 p-4">
              {analytics.byCampaign.slice(0, 8).map((c) => (
                <div
                  key={c.campaign}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {c.campaign}
                  </span>
                  {c.source && (
                    <Chip variant="cyan" mono>
                      {c.source}
                    </Chip>
                  )}
                  <span className="w-10 text-right font-mono text-[12px] font-semibold">
                    {c.total}
                  </span>
                  <span className="w-16 text-right font-mono text-[10.5px] text-foreground-subtle">
                    {c.accepted} accept.
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {modules.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Intag-flöden
              </h2>
              {isStaff && (
                <Link
                  href="/inflode/admin/modules"
                  className="text-[12px] text-foreground-muted hover:text-foreground"
                >
                  Hantera
                </Link>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((m) => {
                const metrics = analytics?.byModule.find((x) => x.slug === m.slug);
                return (
                  <div
                    key={m.id}
                    className="flex h-full flex-col gap-2 rounded-2xl border border-default bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip variant={m.flow_type === 'chat' ? 'cyan' : 'default'} mono>
                        {FLOW_TYPE_LABEL[m.flow_type].toUpperCase()}
                      </Chip>
                      {m.public_url_enabled && (
                        <Chip variant="active" mono>
                          PUBLIK
                        </Chip>
                      )}
                      {!m.is_active && (
                        <Chip variant="draft" mono>
                          UTKAST
                        </Chip>
                      )}
                    </div>
                    <div className="text-[15px] font-semibold text-foreground">{m.name}</div>
                    <div className="text-[12.5px] leading-relaxed text-foreground-muted">
                      {m.description ||
                        'Starta modulen för att beskriva idén och få nästa steg.'}
                    </div>
                    <span className="flex-1" />
                    {isStaff && metrics && (
                      <div className="font-mono text-[11px] text-foreground-subtle">
                        <span className="font-semibold text-foreground">{metrics.total}</span>{' '}
                        leads ·{' '}
                        <span className="font-semibold text-foreground">{metrics.accepted}</span>{' '}
                        accept. ·{' '}
                        <span className="font-semibold text-foreground">{metrics.converted}</span>{' '}
                        bolag
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <Link
                        href={`/inflode/m/${m.slug}`}
                        className="rounded-lg border border-default bg-canvas-muted px-3 py-1.5 text-[12px] text-foreground hover:bg-canvas-subtle"
                      >
                        Starta →
                      </Link>
                      {isStaff && (
                        <Link
                          href={`/inflode/admin/modules/${m.slug}`}
                          className="rounded-lg px-3 py-1.5 text-[12px] text-foreground-muted hover:text-foreground"
                        >
                          Redigera
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isStaff && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Senaste leads
              </h2>
              <Link
                href="/inflode/leads"
                className="text-[12px] text-foreground-muted hover:text-foreground"
              >
                Visa alla →
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
                Inga leads har skapats ännu.
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((lead) => {
                  const source = sourceByKey.get(lead.source_key);
                  const landingMod = lead.landing_module
                    ? moduleBySlug.get(lead.landing_module)
                    : undefined;
                  return (
                    <Link
                      key={lead.id}
                      href={`/inflode/leads/${lead.id}`}
                      className="block rounded-xl border border-default bg-surface p-4 transition hover:border-strong"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-foreground">
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
                          <div className="mt-1 truncate text-[12px] text-foreground-muted">
                            {lead.idea_summary || lead.email || lead.organization || '—'}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[10.5px] uppercase text-foreground-subtle">
                            {source?.label || lead.source_key}
                            {landingMod && ` · ${landingMod.name}`}
                            {lead.utm_campaign && ` · ${lead.utm_campaign}`}
                          </div>
                          {typeof lead.score === 'number' && (
                            <div className="mt-1 font-mono text-[11px] font-semibold text-foreground">
                              {lead.score} p
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </PageShell>
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
