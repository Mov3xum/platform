import Link from 'next/link';
import { Chip, Icon } from '@/components/proto';
import type { LagesredovisningDataset } from '@/lib/reporting/dataset';
import { VINNOVA_LAGESREDOVISNING } from '@/lib/reporting/templates';
import { ExportButton } from './ExportButton';

function fmtSek(n: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n) + ' kr';
}

/**
 * Strukturerad Vinnova-lägesredovisning som renderas inuti en rapport
 * (recipient = vinnova). Auto-fylld ur systemdata; export till xlsx +
 * e-AidRegister-underlag. Server-komponent.
 */
export function VinnovaLagesredovisningView({
  dataset,
  from,
  to,
  rate
}: {
  dataset: LagesredovisningDataset;
  from: string;
  to: string;
  rate: number;
}) {
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-default bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Lägesredovisning aktiebolag
            </div>
            <div className="mt-1 text-[12.5px] text-foreground-muted">
              Period {from} – {to} · ackumulerat från {dataset.programStart} · timpris-default{' '}
              {fmtSek(rate)}.{' '}
              <Link href="/admin/import-vinnova" className="text-link hover:underline">
                Importera arbetsfiler
              </Link>
            </div>
          </div>
          <ExportButton from={from} to={to} />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Inkubatortjänster" value={fmtSek(dataset.totals.inkubator)} />
          <Stat label="Verifieringstjänster" value={fmtSek(dataset.totals.verifiering)} />
          <Stat label="Summa period" value={fmtSek(dataset.totals.summa)} />
          <Stat label="Aktiva bolag / rader" value={`${dataset.startupCount} / ${dataset.rows.length}`} />
        </div>

        <div className="mb-3 rounded-xl bg-canvas-subtle px-3 py-2 text-[11.5px] text-foreground-muted">
          Deterministiskt genererad ur systemdata — verifiera innan inlämning till Vinnova.
          {errors.length > 0 && (
            <span className="ml-1 text-movexum-morkorange">
              {errors.length} fel kräver åtgärd.
            </span>
          )}
          {warnings.length > 0 && (
            <span className="ml-1 text-movexum-morkgul">{warnings.length} varningar.</span>
          )}
        </div>

        {dataset.rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-foreground-muted">
            Inga aktiva bolag med rapporterbar data i perioden. Lägg in tid, kostnader och
            readiness-bedömningar (eller importera de historiska arbetsfilerna) så fylls
            tabellen i automatiskt.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-strong text-left">
                  <th className="px-2 py-2 font-semibold text-foreground-subtle">Status</th>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-2 py-2 font-semibold text-foreground-subtle"
                    >
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
                        const display =
                          c.type === 'currency' && typeof v === 'number' ? fmtSek(v) : String(v ?? '');
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-default bg-canvas-subtle px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-subtle">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}
