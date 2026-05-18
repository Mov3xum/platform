import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Chip, ProgressBar, Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import type { IncubatorReport } from '@platform/shared';
import { ReportDetail } from './ReportDetail';
import { statusChipVariant, statusLabel } from './report-utils';

export default async function RapporterPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/idag');
  }
  const { id: selectedFromQuery } = await searchParams;

  const pb = await getServerPb();
  let reports: IncubatorReport[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.reports).getList<IncubatorReport>(1, 50, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-updated'
    });
    reports = res.items;
  } catch {
    /* collection may not exist yet */
  }

  const selectedId = selectedFromQuery || reports[0]?.id;
  const selected = reports.find((r) => r.id === selectedId) || reports[0] || null;

  const byStatus = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Rapporter" value={reports.length} />
          <RailStat label="Utkast" value={byStatus.draft_ai || 0} />
          <RailStat label="Klara" value={byStatus.sent || 0} />
          <RailStat label="Granskas" value={byStatus.review || 0} />
        </div>
      </RailSection>

      <RailSection label="Senast uppdaterade">
        {reports.slice(0, 5).map((r) => (
          <Link
            key={r.id}
            href={`/rapporter/${r.id}`}
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-muted"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
              <Icon name="doc" size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-foreground">
                {r.title}
              </span>
              <span className="block truncate font-mono text-[10.5px] uppercase text-foreground-subtle">
                {r.recipient_label} · {r.completion || 0}%
              </span>
            </span>
          </Link>
        ))}
      </RailSection>
    </>
  );

  const actions = (
    <Link
      href="/rapporter/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Ny rapport
    </Link>
  );

  return (
    <PageShell title="Rapportering" actions={actions} rightPanel={rail}>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-5 lg:grid-cols-[320px_1fr]">
        <div className="rounded-2xl border border-default bg-surface">
          <div className="flex items-center justify-between border-b border-default px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Rapporter
            </span>
            <span className="font-mono text-[11px] text-foreground-subtle">{reports.length}</span>
          </div>
          {reports.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-foreground-muted">
              Inga rapporter ännu.
            </div>
          ) : (
            <div>
              {reports.map((r) => {
                const isSel = r.id === selected?.id;
                return (
                  <Link
                    key={r.id}
                    href={`/rapporter/${r.id}`}
                    className={`block border-b border-default px-4 py-3 transition last:border-b-0 ${
                      isSel ? 'bg-canvas-muted' : 'hover:bg-canvas-subtle'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-mono text-[10.5px] uppercase text-foreground-subtle">
                        {r.recipient_label}
                      </span>
                      <span className="flex-1" />
                      <Chip variant={statusChipVariant(r.status)} mono>
                        {statusLabel(r.status)}
                      </Chip>
                    </div>
                    <div className="mb-1 text-[13px] font-semibold text-foreground">
                      {r.title}
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar pct={r.completion || 0} accent={r.accent || 'ink'} />
                      <span className="font-mono text-[10.5px] text-foreground-subtle">
                        {r.completion || 0}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <ReportDetail report={selected} />
        ) : (
          <div className="rounded-2xl border border-default bg-surface p-10 text-center">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground-subtle">
              Inga rapporter
            </div>
            <div className="mb-4 text-[13px] text-foreground-muted">
              Skapa din första rapport för Vinnova, Tillväxtverket eller regionen.
            </div>
            <Link
              href="/rapporter/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
            >
              <Icon name="plus" size={12} /> Ny rapport
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
