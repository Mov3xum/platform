import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAllForTenant, listForTenant, hasTenantWideRead } from '@/lib/pb.server';
import { pagerState, parsePageParam } from '@/lib/read-scaling';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase, type SprintXScore } from '@platform/shared';
import { phaseLabels, statusLabels, type StartupStatus } from '@/lib/labels';
import { StartupListDashboard } from '@/components/StartupListDashboard';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { Chip, Icon } from '@/components/proto';
import { countLeadsByStatus, listLeads } from '@/lib/compass/store';
import { LEAD_STATUS_LABEL, LEAD_STATUS_ORDER } from '@/lib/compass/types';
import { buildStartupTabs } from './_tabs';

export const dynamic = 'force-dynamic';

/** En rad i bolagstabellen — bara fälten tabellen renderar. */
interface StartupRecord {
  id: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
}

/** Underlaget för portföljstatistiken — inga fritextfält. */
interface StartupMetricRow {
  id: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  sprint_x_json?: SprintXScore;
}

// Skalbarhetsgranskning 2026-10-08: listan läste 200 hela bolagsposter (alla
// fält, ingen paginering) — fler än 200 bolag försvann tyst ur både tabell och
// statistik. Nu: tabellen pagineras server-side (PAGE_SIZE per sida, ?page=)
// med bara tabellens fält, och statistiken läses separat med minimala fält
// över ALLA bolag upp till ett tak som rapporteras ärligt (§ 33.4).
const PAGE_SIZE = 100;
const TABLE_FIELDS = 'id,name,description,phase,status,irl_level,next_step';
const METRIC_FIELDS = 'id,phase,status,irl_level,sprint_x_json';
const METRIC_MAX_ROWS = 5_000;

const IN_FUNNEL_STATUSES = ['new', 'contacted', 'meeting-booked', 'evaluating'] as const;

export default async function StartupsOverviewPage({
  searchParams
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) redirect('/dashboard');
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const canCreate = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  // Bolagsisolering (CLAUDE.md § 21): en ren startup_member ska aldrig se
  // portfölj-översikten. Har hen exakt ett bolag → direkt till bolagskortet.
  const memberScoped = !hasTenantWideRead(user);
  if (memberScoped) {
    if (user.linkedStartups.length === 1) redirect(`/startups/${user.linkedStartups[0]}`);
    if (user.linkedStartups.length === 0) redirect('/dashboard');
  }

  const page = parsePageParam((await searchParams)?.page);
  const pb = await getServerPb();
  let items: StartupRecord[] = [];
  let metricRows: StartupMetricRow[] = [];
  let totalItems = 0;
  let loadFailed = false;
  let metricsNotice: string | null = null;
  // `scopeToStartupField: 'id'` begränsar listan till medlemmens länkade
  // bolag (tom no-op för staff/observer). Läsningar via användarens token (RLS § 21).
  const [tableRes, metricsRes] = await Promise.allSettled([
    listForTenant<StartupRecord>('startups', {
      sort: 'name',
      page,
      perPage: PAGE_SIZE,
      fields: TABLE_FIELDS,
      scopeToStartupField: 'id'
    }),
    listAllForTenant<StartupMetricRow>('startups', {
      sort: 'id',
      fields: METRIC_FIELDS,
      scopeToStartupField: 'id',
      maxRows: METRIC_MAX_ROWS
    })
  ]);
  if (tableRes.status === 'fulfilled') {
    items = tableRes.value.items;
    totalItems = tableRes.value.totalItems;
  } else {
    loadFailed = true;
    console.error('[startups] overview load failed', {
      tenant: user.tenant,
      userId: user.id,
      error: tableRes.reason
    });
  }
  if (metricsRes.status === 'fulfilled') {
    metricRows = metricsRes.value.items;
    totalItems = Math.max(totalItems, metricsRes.value.total);
    if (!metricsRes.value.complete) {
      metricsNotice = `Statistiken bygger på de första ${metricRows.length} av ${metricsRes.value.total} bolag.`;
    }
  } else {
    // Statistiken kunde inte läsas — räkna på tabellsidan och säg det.
    metricRows = items;
    if (!loadFailed) {
      metricsNotice = 'Portföljstatistiken kunde inte läsas helt — siffrorna gäller bara bolagen på den här sidan.';
    }
    console.error('[startups] overview metrics failed', {
      tenant: user.tenant,
      userId: user.id,
      error: metricsRes.reason
    });
  }
  const pager = pagerState(page, PAGE_SIZE, totalItems);

  const [statusCounts, recentLeads] = await Promise.all([
    isStaff ? countLeadsByStatus(pb, user.tenant) : Promise.resolve(null),
    isStaff ? listLeads(pb, user.tenant, { perPage: 5 }).then((r) => r.items) : Promise.resolve([])
  ]);

  const leadTotal = statusCounts
    ? LEAD_STATUS_ORDER.reduce((s, k) => s + (statusCounts[k] || 0), 0)
    : 0;
  const inFunnel = statusCounts
    ? IN_FUNNEL_STATUSES.reduce((s, k) => s + (statusCounts[k] || 0), 0)
    : 0;
  const conversionRate =
    statusCounts && leadTotal > 0 ? Math.round((100 * (statusCounts.accepted || 0)) / leadTotal) : 0;

  const irlSamples = metricRows.filter((s) => s.irl_level);
  const avgIRL = irlSamples.length
    ? irlSamples.reduce((sum, s) => sum + (s.irl_level || 0), 0) / irlSamples.length
    : 0;
  const sxAvg = (key: keyof SprintXScore) => {
    const list = metricRows.filter((s) => s.sprint_x_json?.[key]);
    return list.length
      ? list.reduce((sum, s) => sum + (s.sprint_x_json?.[key] || 0), 0) / list.length
      : 0;
  };
  const metrics = {
    totalStartups: totalItems,
    activeStartups: metricRows.filter((s) => s.status === 'active').length,
    byPhase: metricRows.reduce(
      (acc, s) => {
        acc[s.phase] = (acc[s.phase] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    byStatus: metricRows.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    avgIRLLevel: avgIRL,
    avgSprintX: { funding: sxAvg('funding'), intl: sxAvg('intl'), sustain: sxAvg('sustain'), team: sxAvg('team') }
  };

  const tabs = buildStartupTabs({ isStaff, inflowBadge: inFunnel });

  const rail = (
    <>
      <RailSection label="Portfölj">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Bolag" value={totalItems} />
          <RailStat label="Aktiva" value={metrics.activeStartups} />
          <RailStat label="∅ IRL" value={avgIRL ? avgIRL.toFixed(1) : '—'} />
          <RailStat label="Faser" value={Object.keys(metrics.byPhase).length} />
        </div>
      </RailSection>

      {isStaff && statusCounts && (
        <RailSection label="Inflöde">
          <div className="grid grid-cols-2 gap-2 px-2">
            <RailStat label="I tratt" value={inFunnel} />
            <RailStat label="Accepterade" value={statusCounts.accepted || 0} />
            <RailStat label="Konvertering" value={`${conversionRate}%`} />
            <RailStat label="Avböjda" value={statusCounts.declined || 0} />
          </div>
        </RailSection>
      )}

      <RailSection label="Per fas">
        {ALL_PHASES.filter((p) => metrics.byPhase[p]).map((p) => (
          <Link
            key={p}
            href={`/startups/inkubator?phase=${p}`}
            className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-foreground-muted hover:bg-canvas-muted hover:text-foreground"
          >
            {phaseLabels[p]}
            <span className="font-mono text-[11px] text-foreground-subtle">{metrics.byPhase[p]}</span>
          </Link>
        ))}
      </RailSection>
    </>
  );

  const actions = canCreate ? (
    <Link
      href="/startups/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Nytt bolag
    </Link>
  ) : null;

  return (
    <PageShell
      title="Startups"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {totalItems} bolag i {user.tenantName || 'tenanten'}
        </span>
      }
      tabs={tabs}
      actions={actions}
      rightPanel={rail}
    >
      <div className="space-y-6 py-6">
        {loadFailed && (
          <div className="rounded-xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Kunde inte ladda portföljen just nu. Försök igen om en stund.
          </div>
        )}

        {metricsNotice && (
          <div className="rounded-xl border border-default bg-movexum-pastell-orange p-4 text-[13px] text-movexum-morkorange">
            {metricsNotice}
          </div>
        )}

        {items.length === 0 && pager.outOfRange && (
          <div className="rounded-xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Sidan {page} finns inte — portföljen har {pager.totalPages}{' '}
            {pager.totalPages === 1 ? 'sida' : 'sidor'}.{' '}
            <Link href={pageHref(pager.totalPages)} className="text-link hover:underline">
              Gå till sista sidan
            </Link>
          </div>
        )}

        {items.length > 0 || metricRows.length > 0 ? (
          <StartupListDashboard startups={metricRows} metrics={metrics} />
        ) : (
          !loadFailed && (
            <div className="rounded-2xl border border-dashed border-default p-12 text-center">
              <h2 className="text-base font-semibold text-foreground">Inga bolag än</h2>
              <p className="mt-2 text-[13px] text-foreground-muted">
                Konvertera ett lead från inflödet eller skapa ett bolag manuellt.
              </p>
              {canCreate && (
                <Link
                  href="/startups/new"
                  className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover"
                >
                  + Nytt bolag
                </Link>
              )}
            </div>
          )
        )}

        {items.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-default bg-surface">
            <div className="flex items-center justify-between border-b border-default px-5 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Alla bolag · {totalItems}
                {pager.totalPages > 1 && ` · visar ${pager.from}–${pager.to}`}
              </span>
              <Link
                href="/startups/inkubator"
                className="text-[12px] text-foreground-muted hover:text-foreground"
              >
                Kortvy →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-default text-[10.5px] uppercase tracking-wide text-foreground-subtle">
                    <th className="px-5 py-2.5 font-semibold">Bolag</th>
                    <th className="px-3 py-2.5 font-semibold">Fas</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 text-right font-semibold">IRL</th>
                    <th className="px-3 py-2.5 font-semibold">Nästa steg</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-default last:border-0 hover:bg-canvas-muted"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/startups/${s.id}`}
                          className="font-medium text-foreground hover:text-link hover:underline"
                        >
                          {s.name}
                        </Link>
                        {s.description && (
                          <div className="mt-0.5 max-w-md truncate text-[12px] text-foreground-subtle">
                            {s.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-foreground-muted">
                        {phaseLabels[s.phase] ?? s.phase}
                      </td>
                      <td className="px-3 py-3 text-foreground-muted">
                        {statusLabels[s.status] ?? s.status}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-foreground-muted">
                        {s.irl_level ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-foreground-subtle">
                        <span className="block max-w-xs truncate">{s.next_step || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pager.totalPages > 1 && (
              <nav
                aria-label="Sidnavigering"
                className="flex flex-wrap items-center justify-center gap-2 border-t border-default px-5 py-3 text-[12px]"
              >
                {pager.hasPrev && (
                  <Link
                    href={pageHref(page - 1)}
                    rel="prev"
                    className="rounded-lg border border-default px-3 py-1.5 text-foreground-muted hover:border-strong hover:text-foreground"
                  >
                    ← Föregående
                  </Link>
                )}
                <span className="font-mono tabular-nums text-foreground-subtle">
                  Sida {page} av {pager.totalPages}
                </span>
                {pager.hasNext && (
                  <Link
                    href={pageHref(page + 1)}
                    rel="next"
                    className="rounded-lg border border-default px-3 py-1.5 text-foreground-muted hover:border-strong hover:text-foreground"
                  >
                    Nästa →
                  </Link>
                )}
              </nav>
            )}
          </section>
        )}

        {isStaff && statusCounts && (
          <section className="rounded-2xl border border-default bg-surface">
            <div className="flex items-center justify-between border-b border-default px-5 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Inflöde · bolag på väg in
              </span>
              <Link
                href="/startups/inflode"
                className="text-[12px] text-foreground-muted hover:text-foreground"
              >
                Till inflödet →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-6">
              {LEAD_STATUS_ORDER.map((status) => {
                const n = statusCounts[status] || 0;
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
                  </Link>
                );
              })}
            </div>
            {recentLeads.length > 0 && (
              <div className="space-y-1 border-t border-default p-4">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                  Senaste inkomna
                </div>
                {recentLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/inflode/leads/${lead.id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-canvas-muted"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {lead.name || 'Anonym'}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-[12px] text-foreground-subtle md:block">
                      {lead.idea_summary || lead.organization || '—'}
                    </span>
                    <Chip variant={lead.converted_startup ? 'active' : 'draft'} mono>
                      {LEAD_STATUS_LABEL[lead.status]}
                    </Chip>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}

function pageHref(page: number): string {
  return page <= 1 ? '/startups' : `/startups?page=${page}`;
}
