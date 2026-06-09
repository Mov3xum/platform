// Startupkompassen — Analys (statistik & djupare analys av inflödet)

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { KpiBlock } from '@/components/proto';
import { ServerChart } from '@/components/charts/ServerChart';
import type { MovexumChartSpec } from '@/lib/charts/echarts-theme';
import {
  countLeadsByStatus,
  getLeadAnalytics,
  listLeadSources,
  listModules
} from '@/lib/compass/store';
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER } from '@/lib/compass/types';
import { buildInflodeTabs } from '../_tabs';
import { PeriodFilter, formatNumber, formatPct, parsePeriod } from '../_ui';

export const dynamic = 'force-dynamic';

const VIEWS = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'kallor', label: 'Källor' },
  { id: 'moduler', label: 'Moduler' },
  { id: 'quiz', label: 'Quiz-resultat' },
  { id: 'kampanjer', label: 'Kampanjer' }
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

export default async function InflodeAnalysisPage({
  searchParams
}: {
  searchParams?: Promise<{ days?: string; view?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'inflode', user.disabledModules)) {
    redirect('/dashboard');
  }
  // Analys är staff-only (aggregerad lead-data, CLAUDE.md § 21).
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/inflode');
  }

  const params = (await searchParams) || {};
  const days = parsePeriod(params.days);
  const view: ViewId = (VIEWS.find((v) => v.id === params.view)?.id || 'oversikt') as ViewId;

  const pb = await getServerPb();
  const [analytics, funnelCounts, sources, modules] = await Promise.all([
    getLeadAnalytics(pb, user.tenant, days),
    countLeadsByStatus(pb, user.tenant),
    listLeadSources(pb),
    listModules(pb, user.tenant)
  ]);

  const sourceLabel = new Map(sources.map((s) => [s.key, s.label]));
  // landing_module lagras som publik slug (publika flöden) eller intern slug
  // (admin-preview) → mappa båda till modulnamn.
  const moduleName = new Map<string, string>();
  for (const m of modules) {
    if (m.public_slug) moduleName.set(m.public_slug, m.name);
    moduleName.set(m.slug, m.name);
  }
  // Resultatprofilens nyckel → titel (per modul), för quiz-fördelningen.
  const bucketTitle = new Map<string, string>();
  for (const m of modules) {
    for (const b of m.result_buckets ?? []) {
      if (m.public_slug) bucketTitle.set(`${m.public_slug}|${b.key}`, b.title);
      bucketTitle.set(`${m.slug}|${b.key}`, b.title);
    }
  }

  const conversionRate = analytics.total > 0 ? analytics.accepted / analytics.total : 0;
  const maxFunnel = Math.max(...LEAD_STATUS_ORDER.map((s) => funnelCounts[s] || 0), 1);

  // En modul kan förekomma under BÅDE sin publika och interna slug i
  // landing_module — slå ihop per visningsnamn så den inte ser ut som två.
  const byModuleMerged = (() => {
    const map = new Map<string, { name: string; total: number; accepted: number; converted: number }>();
    for (const m of analytics.byModule) {
      const name = moduleName.get(m.slug) || m.slug;
      let row = map.get(name);
      if (!row) {
        row = { name, total: 0, accepted: 0, converted: 0 };
        map.set(name, row);
      }
      row.total += m.total;
      row.accepted += m.accepted;
      row.converted += m.converted;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();

  const byQuizBucketMerged = (() => {
    const map = new Map<string, { name: string; bucket: string; count: number }>();
    for (const qb of analytics.byQuizBucket) {
      const name = moduleName.get(qb.module) || qb.module || 'Okänd modul';
      const bucket = bucketTitle.get(`${qb.module}|${qb.bucket}`) || qb.bucket;
      const key = `${name}|${bucket}`;
      let row = map.get(key);
      if (!row) {
        row = { name, bucket, count: 0 };
        map.set(key, row);
      }
      row.count += qb.count;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count);
  })();

  const tabs = buildInflodeTabs();

  const weeklySpec: MovexumChartSpec = {
    type: 'line',
    categories: analytics.weekly.map((w) => w.week),
    series: [
      { name: 'Leads', values: analytics.weekly.map((w) => w.total) },
      { name: 'Accepterade', values: analytics.weekly.map((w) => w.accepted) }
    ]
  };
  const sourceSpec: MovexumChartSpec = {
    type: 'hbar',
    categories: analytics.bySource.slice(0, 10).map((s) => sourceLabel.get(s.source_key) || s.source_key),
    series: [{ name: 'Leads', values: analytics.bySource.slice(0, 10).map((s) => s.total) }]
  };
  const moduleSpec: MovexumChartSpec = {
    type: 'hbar',
    categories: byModuleMerged.slice(0, 10).map((m) => m.name),
    series: [{ name: 'Leads', values: byModuleMerged.slice(0, 10).map((m) => m.total) }]
  };

  const rail = (
    <RailSection label="Sammanfattning">
      <div className="grid grid-cols-2 gap-2 px-2">
        <RailStat label={`Leads · ${days} dgr`} value={formatNumber(analytics.total)} />
        <RailStat label="Accepterade" value={formatNumber(analytics.accepted)} />
        <RailStat label="Bolag" value={formatNumber(analytics.converted)} />
        <RailStat label="Konvertering" value={formatPct(conversionRate)} />
      </div>
    </RailSection>
  );

  return (
    <PageShell title="Startupkompassen" tabs={tabs} rightPanel={rail}>
      <div className="space-y-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-foreground-muted">
            Statistik &amp; analys · senaste {days} dagarna
          </p>
          <PeriodFilter days={days} basePath="/inflode/analysis" params={{ view }} />
        </div>

        {/* KPI-kort */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiBlock label="Leads i perioden" value={formatNumber(analytics.total)} hint="totalt" />
          <KpiBlock
            label="Accepterade"
            value={formatNumber(analytics.accepted)}
            hint={`av ${formatNumber(analytics.total)}`}
          />
          <KpiBlock label="Konverterade bolag" value={formatNumber(analytics.converted)} hint="st" />
          <KpiBlock label="Konverteringsgrad" value={formatPct(conversionRate)} hint="acc. / totalt" />
        </div>

        {/* Vy-väljare */}
        <nav className="mx-flex mx-gap-2 mx-wrap" aria-label="Analysvy">
          {VIEWS.map((v) => {
            const qs = new URLSearchParams({ view: v.id, days: String(days) });
            const active = v.id === view;
            return (
              <Link
                key={v.id}
                href={`/inflode/analysis?${qs.toString()}`}
                className={`mx-chip mx-mono${active ? ' mx-ink-chip' : ''}`}
                style={{ textDecoration: 'none' }}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>

        {view === 'oversikt' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-default bg-surface p-4">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Leads per vecka
              </h2>
              {analytics.weekly.length > 0 ? (
                <ServerChart spec={weeklySpec} width={900} height={300} />
              ) : (
                <Empty>Inga leads under perioden.</Empty>
              )}
            </section>

            <section className="rounded-2xl border border-default bg-surface">
              <div className="border-b border-default px-5 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                  Konverteringstratt · all-time
                </span>
              </div>
              <div className="space-y-3 p-5">
                {LEAD_STATUS_ORDER.map((status) => {
                  const count = funnelCounts[status] || 0;
                  const widthPct = Math.max(6, Math.round((count / maxFunnel) * 100));
                  const declined = status === 'declined';
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-right text-[12px] text-foreground-muted">
                        {LEAD_STATUS_LABEL[status]}
                      </span>
                      <div className="relative flex-1">
                        <div
                          className={`h-6 rounded-full ${declined ? 'bg-canvas-muted' : 'bg-brand'}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-[13px] text-foreground tabular-nums">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {view === 'kallor' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-default bg-surface p-4">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Leads per källa
              </h2>
              {analytics.bySource.length > 0 ? (
                <ServerChart spec={sourceSpec} width={900} height={300} />
              ) : (
                <Empty>Inga källor registrerade.</Empty>
              )}
            </section>
            <AnalyticsTable
              head={['Källa', 'Leads', 'I tratt', 'Accepterade', 'Konv.']}
              rows={analytics.bySource.map((s) => [
                sourceLabel.get(s.source_key) || s.source_key,
                formatNumber(s.total),
                formatNumber(s.in_funnel),
                formatNumber(s.accepted),
                formatPct(s.total > 0 ? s.accepted / s.total : 0)
              ])}
              empty="Inga källor under perioden."
            />
          </div>
        )}

        {view === 'moduler' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-default bg-surface p-4">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Leads per modul
              </h2>
              {byModuleMerged.length > 0 ? (
                <ServerChart spec={moduleSpec} width={900} height={300} />
              ) : (
                <Empty>Inga moduler har genererat leads ännu.</Empty>
              )}
            </section>
            <AnalyticsTable
              head={['Modul', 'Leads', 'Accepterade', 'Bolag', 'Konv.']}
              rows={byModuleMerged.map((m) => [
                m.name,
                formatNumber(m.total),
                formatNumber(m.accepted),
                formatNumber(m.converted),
                formatPct(m.total > 0 ? m.accepted / m.total : 0)
              ])}
              empty="Inga moduler under perioden."
            />
          </div>
        )}

        {view === 'quiz' && (
          <div className="space-y-4">
            <p className="text-[12px] text-foreground-muted">
              Hur besökarna fördelar sig över quiz-modulernas resultatprofiler — ett
              snabbt mått på kvaliteten i inflödet per kanal/modul.
            </p>
            <AnalyticsTable
              head={['Modul', 'Resultatprofil', 'Antal', 'Andel av modulen']}
              rows={byQuizBucketMerged.map((qb) => {
                const moduleTotal = byQuizBucketMerged
                  .filter((x) => x.name === qb.name)
                  .reduce((s, x) => s + x.count, 0);
                return [
                  qb.name,
                  qb.bucket,
                  formatNumber(qb.count),
                  formatPct(moduleTotal > 0 ? qb.count / moduleTotal : 0)
                ];
              })}
              empty="Inga quiz-resultat under perioden. Resultaten dyker upp här när besökare slutför en quiz-modul."
            />
          </div>
        )}

        {view === 'kampanjer' && (
          <AnalyticsTable
            head={['Kampanj', 'Källa', 'Medium', 'Leads', 'Accepterade']}
            rows={analytics.byCampaign.map((c) => [
              c.campaign,
              c.source || '—',
              c.medium || '—',
              formatNumber(c.total),
              formatNumber(c.accepted)
            ])}
            empty="Inga UTM-kampanjer registrerade under perioden."
          />
        )}
      </div>
    </PageShell>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-[13px] text-foreground-subtle">
      {children}
    </div>
  );
}

function AnalyticsTable({
  head,
  rows,
  empty
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-default bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-default">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri} className="border-b border-default last:border-0">
              {cells.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-2.5 ${ci === 0 ? 'font-medium text-foreground' : 'text-right font-mono text-foreground-muted tabular-nums'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
