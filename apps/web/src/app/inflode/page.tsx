// Startupkompassen — Dashboard (översikt över inflödet)

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat } from '@/components/PageRail';
import { Chip, Icon, KpiBlock, Spark } from '@/components/proto';
import { ServerChart } from '@/components/charts/ServerChart';
import type { MovexumChartSpec } from '@/lib/charts/echarts-theme';
import {
  getCompassDashboard,
  listLeads,
  listLeadSources,
  listModules
} from '@/lib/compass/store';
import {
  FLOW_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  type LeadStatus
} from '@/lib/compass/types';
import { buildInflodeTabs } from './_tabs';
import { DeltaChip, PeriodFilter, formatNumber, formatPct, parsePeriod } from './_ui';

export const dynamic = 'force-dynamic';

export default async function InflodeDashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  // Bolagsisolering (CLAUDE.md § 21): inflöde/leads är tenant-bred och får
  // aldrig nås av en ren startup_member.
  if (!canAccessModuleForUser(user.roles, 'inflode', user.disabledModules)) {
    redirect('/dashboard');
  }
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const days = parsePeriod((await searchParams)?.days);

  const pb = await getServerPb();
  const sources = await listLeadSources(pb);
  const [dashboard, recent, modules] = await Promise.all([
    getCompassDashboard(pb, user.tenant, days, sources),
    isStaff
      ? listLeads(pb, user.tenant, { perPage: 6 }).then((r) => r.items)
      : Promise.resolve([]),
    listModules(pb, user.tenant, { onlyActive: !isStaff })
  ]);

  const { kpis, leadsPerDay, leadsPerSource, funnel } = dashboard;
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  // landing_module kan vara modulens publika ELLER interna slug — mappa båda.
  const moduleBySlug = new Map(modules.map((m) => [m.slug, m]));
  for (const m of modules) {
    if (m.public_slug) moduleBySlug.set(m.public_slug, m);
  }
  const maxFunnel = Math.max(...funnel.map((f) => f.count), 1);

  const tabs = buildInflodeTabs();

  const leadsPerDaySpec: MovexumChartSpec = {
    type: 'area',
    categories: leadsPerDay.map((d) => d.date.slice(5)),
    series: [{ name: 'Leads', values: leadsPerDay.map((d) => d.count) }]
  };
  const sourceSpec: MovexumChartSpec = {
    type: 'hbar',
    categories: leadsPerSource.map((s) => s.label),
    series: [{ name: 'Leads', values: leadsPerSource.map((s) => s.count) }]
  };

  const actions = (
    <>
      <Link href="/inflode/chat" className="mx-btn" title="Testa AI-intagschatten som Movexum-personal">
        <Icon name="sparkle" size={13} /> Testa AI-intag
      </Link>
      {isStaff && (
        <Link href="/inflode/leads/new" className="mx-btn mx-primary">
          <Icon name="plus" size={13} /> Nytt lead
        </Link>
      )}
    </>
  );

  const rail = (
    <>
      <RailSection label="Pipeline">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Totalt" value={formatNumber(kpis.totalLeads)} />
          <RailStat label="I tratt" value={formatNumber(kpis.activePipeline)} />
          <RailStat label="Konvertering" value={formatPct(kpis.conversionRate)} />
          <RailStat label="Snittpoäng" value={kpis.avgScore || '—'} />
        </div>
      </RailSection>

      {leadsPerSource.length > 0 && (
        <RailSection label={`Källor · ${days} dgr`}>
          {leadsPerSource.slice(0, 6).map((s) => (
            <Link
              key={s.source_key}
              href={`/inflode/leads?src=${encodeURIComponent(s.source_key)}`}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-muted"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {s.label}
              </span>
              <span className="font-mono text-[11px] text-foreground">{s.count}</span>
            </Link>
          ))}
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

  return (
    <PageShell title="Startupkompassen" tabs={tabs} actions={actions} rightPanel={rail}>
      <div className="space-y-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-foreground-muted">
            Översikt över inflödet · senaste {days} dagarna
          </p>
          <PeriodFilter days={days} basePath="/inflode" />
        </div>

        {/* Kom igång — visas tills första modulen/leadet finns */}
        {isStaff && kpis.totalLeads === 0 && modules.length === 0 && (
          <section className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-8 text-center">
            <h2 className="font-heading text-[17px] font-semibold text-foreground">
              Kom igång med Startupkompassen
            </h2>
            <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-relaxed text-foreground-muted">
              Bygg en intag-modul (quiz, formulär eller AI-chatt), deploya den publikt
              med QR-kod i de forum ni rör er, och följ upp inflödet här — varje
              slutfört flöde blir ett lead.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link href="/inflode/admin/modules/new" className="mx-btn mx-primary">
                <Icon name="plus" size={13} /> Skapa din första modul
              </Link>
              <Link href="/inflode/admin/modules" className="mx-btn">
                Visa moduler
              </Link>
            </div>
          </section>
        )}

        {/* KPI-kort */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiBlock
            label="Leads denna period"
            value={formatNumber(kpis.leadsThisPeriod)}
            hint={`av ${formatNumber(kpis.totalLeads)}`}
            spark={
              leadsPerDay.some((d) => d.count > 0) ? (
                <Spark data={leadsPerDay.map((d) => d.count)} color="var(--mx-ink)" />
              ) : undefined
            }
            foot={<DeltaChip delta={kpis.leadsDelta} />}
          />
          <KpiBlock
            label="Konverteringsgrad"
            value={formatPct(kpis.conversionRate)}
            hint="accepterade"
            foot={
              <span className="text-[11px] text-foreground-subtle">
                Accepterade / totalt antal leads
              </span>
            }
          />
          <KpiBlock
            label="Aktiv pipeline"
            value={formatNumber(kpis.activePipeline)}
            hint="i tratt"
            foot={
              <span className="text-[11px] text-foreground-subtle">
                Leads i aktiva steg
              </span>
            }
          />
          <KpiBlock
            label="Snittpoäng"
            value={kpis.avgScore || '—'}
            hint="/ 100"
            foot={<DeltaChip delta={kpis.scoreDelta} />}
          />
        </div>

        {/* Trend + källor */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-default bg-surface p-4">
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Leads per dag
            </h2>
            {leadsPerDay.some((d) => d.count > 0) ? (
              <ServerChart spec={leadsPerDaySpec} width={620} height={260} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-[13px] text-foreground-subtle">
                Inga leads under perioden.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-default bg-surface p-4">
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Leads per källa
            </h2>
            {leadsPerSource.length > 0 ? (
              <ServerChart spec={sourceSpec} width={620} height={260} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-[13px] text-foreground-subtle">
                Inga källor registrerade.
              </div>
            )}
          </section>
        </div>

        {/* Konverteringstratt */}
        <section className="rounded-2xl border border-default bg-surface">
          <div className="border-b border-default px-5 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Konverteringstratt · all-time
            </span>
          </div>
          <div className="space-y-3 p-5">
            {funnel.map((stage) => {
              const widthPct = Math.max(6, Math.round((stage.count / maxFunnel) * 100));
              const declined = stage.status === 'declined';
              return (
                <div key={stage.status} className="flex items-center gap-3">
                  <Link
                    href={`/inflode/leads?status=${encodeURIComponent(stage.status)}`}
                    className="w-28 shrink-0 text-right text-[12px] text-foreground-muted hover:text-foreground"
                  >
                    {LEAD_STATUS_LABEL[stage.status]}
                  </Link>
                  <div className="relative flex-1">
                    <div
                      className={`h-6 rounded-full ${declined ? 'bg-canvas-muted' : 'bg-brand'}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[13px] text-foreground tabular-nums">
                    {stage.count}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Senaste leads (staff) */}
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
                          </div>
                          <div className="mt-1 truncate text-[12px] text-foreground-muted">
                            {lead.idea_summary || lead.email || lead.organization || '—'}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[10.5px] uppercase text-foreground-subtle">
                            {source?.label || lead.source_key}
                            {landingMod && ` · ${landingMod.name}`}
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
