import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { Chip, Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { buildVinnovaLagesredovisning, FALLBACK_HOURLY_RATE } from '@/lib/reporting/dataset';
import { VINNOVA_LAGESREDOVISNING } from '@/lib/reporting/templates';
import { PROGRAM_START } from '@platform/shared';
import { ExportButton } from './ExportButton';

const STAFF: Array<'admin' | 'incubator_lead' | 'coach'> = ['admin', 'incubator_lead', 'coach'];

function fmtSek(n: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n) + ' kr';
}

export default async function VinnovaLagesredovisningPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF)) redirect('/chatt');

  const { from: qFrom, to: qTo } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const from = qFrom && DATE_RE.test(qFrom) ? qFrom : PROGRAM_START;
  const to = qTo && DATE_RE.test(qTo) ? qTo : today;

  const pb = await getServerPb();
  let rate = FALLBACK_HOURLY_RATE;
  try {
    const t = await pb.collection('tenants').getOne(user.tenant);
    const r = (t as { default_hourly_rate_sek?: number }).default_hourly_rate_sek;
    if (r && r > 0) rate = r;
  } catch {
    /* default */
  }

  const dataset = await buildVinnovaLagesredovisning(pb, user.tenant, { from, to }, { hourlyRate: rate });

  const errors = dataset.issues.filter((i) => i.severity === 'error');
  const warnings = dataset.issues.filter((i) => i.severity === 'warning');
  const issuesByStartup = new Map<string, { errors: number; warnings: number }>();
  for (const i of dataset.issues) {
    const e = issuesByStartup.get(i.startupId) || { errors: 0, warnings: 0 };
    if (i.severity === 'error') e.errors++;
    else e.warnings++;
    issuesByStartup.set(i.startupId, e);
  }

  const cols = VINNOVA_LAGESREDOVISNING.columns;

  const rail = (
    <>
      <RailSection label="Period">
        <div className="px-2 text-[12px] text-foreground-muted">
          {from} – {to}
          <div className="mt-1 font-mono text-[10.5px] uppercase text-foreground-subtle">
            Ackumulerat från {dataset.programStart}
          </div>
        </div>
      </RailSection>
      <RailSection label="Utfall (period)">
        <div className="grid grid-cols-1 gap-2 px-2">
          <RailStat label="Inkubatortjänster" value={fmtSek(dataset.totals.inkubator)} />
          <RailStat label="Verifieringstjänster" value={fmtSek(dataset.totals.verifiering)} />
          <RailStat label="Summa" value={fmtSek(dataset.totals.summa)} />
        </div>
      </RailSection>
      <RailSection label="Datakvalitet">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Aktiva bolag" value={dataset.startupCount} />
          <RailStat label="Rader" value={dataset.rows.length} />
          <RailStat label="Fel" value={errors.length} />
          <RailStat label="Varningar" value={warnings.length} />
        </div>
        <div className="px-2 pt-2 font-mono text-[10.5px] uppercase text-foreground-subtle">
          Timpris-default {fmtSek(rate)}
        </div>
      </RailSection>
    </>
  );

  const actions = <ExportButton from={from} to={to} />;

  return (
    <PageShell title="Vinnova — lägesredovisning" actions={actions} rightPanel={rail}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 py-5">
        <div className="rounded-2xl border border-default bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12.5px] text-foreground-muted">
              Varje rad auto-fylls från systemets data (tid × timpris, externa kostnader,
              senaste readiness-bedömning och statsstödsgrund). En rad per bolag och stödgrund.
            </div>
            <form method="get" className="flex items-center gap-2">
              <label className="font-mono text-[10.5px] uppercase text-foreground-subtle">Från</label>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="rounded-lg border border-default bg-canvas px-2 py-1 text-[12.5px] text-foreground"
              />
              <label className="font-mono text-[10.5px] uppercase text-foreground-subtle">Till</label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="rounded-lg border border-default bg-canvas px-2 py-1 text-[12.5px] text-foreground"
              />
              <button
                type="submit"
                className="rounded-lg border border-default px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-canvas-muted"
              >
                Uppdatera
              </button>
            </form>
          </div>

          <div className="mb-3 rounded-xl bg-canvas-subtle px-3 py-2 text-[11.5px] text-foreground-muted">
            AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Denna rapport är
            deterministiskt genererad ur systemdata — verifiera innan inlämning till Vinnova.
          </div>

          {dataset.rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-foreground-muted">
              Inga aktiva bolag med rapporterbar data i perioden. Lägg in tid, kostnader och
              readiness-bedömningar per bolag så fylls tabellen i automatiskt.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-strong text-left">
                    <th className="px-2 py-2 font-semibold text-foreground-subtle">Status</th>
                    {cols.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-2 py-2 font-semibold text-foreground-subtle">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataset.rows.map((row, idx) => {
                    const iss = issuesByStartup.get(row.startupId);
                    return (
                      <tr
                        key={`${row.startupId}-${row.basis ?? 'none'}-${idx}`}
                        className="border-b border-default align-top hover:bg-canvas-subtle"
                      >
                        <td className="px-2 py-2">
                          {iss && iss.errors > 0 ? (
                            <Chip variant="danger" mono>
                              {iss.errors} fel
                            </Chip>
                          ) : iss && iss.warnings > 0 ? (
                            <Chip variant="yellow" mono>
                              {iss.warnings} varn.
                            </Chip>
                          ) : (
                            <Chip variant="green" mono>
                              OK
                            </Chip>
                          )}
                        </td>
                        {cols.map((c) => {
                          const v = c.resolve(row);
                          const display = c.type === 'currency' && typeof v === 'number' ? fmtSek(v) : String(v ?? '');
                          return (
                            <td key={c.key} className="max-w-[260px] px-2 py-2 text-foreground">
                              <span className="block truncate" title={display}>
                                {display || '—'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {dataset.issues.length > 0 && (
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Att åtgärda före inlämning ({dataset.issues.length})
            </div>
            <ul className="space-y-1">
              {dataset.issues.slice(0, 40).map((i, n) => (
                <li key={n} className="flex items-center gap-2 text-[12px]">
                  <Icon
                    name={i.severity === 'error' ? 'alert' : 'doc'}
                    size={12}
                    className={i.severity === 'error' ? 'text-movexum-morkorange' : 'text-movexum-morkgul'}
                  />
                  <span className="font-medium text-foreground">{i.name}</span>
                  <span className="text-foreground-muted">— {i.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-[11.5px] text-foreground-subtle">
          Se{' '}
          <Link href="/rapporter" className="text-link hover:underline">
            narrativa rapporter
          </Link>{' '}
          för Tillväxtverket/InkRapp-underlag.
        </div>
      </div>
    </PageShell>
  );
}
