import Link from 'next/link';

/** Periodval (dagar) — speglar movexum-token-usage:s dashboard/analys. */
export const PERIOD_OPTIONS = [7, 30, 60, 90] as const;

export function parsePeriod(raw: string | undefined, fallback = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(7, Math.trunc(n)));
}

/**
 * Server-renderad periodväljare som chips (länkar med `?days=`). Ren
 * server-komponent — ingen klient-JS, behåller appens server-first-mönster.
 */
export function PeriodFilter({
  days,
  basePath,
  params = {}
}: {
  days: number;
  basePath: string;
  /** Extra query-params som ska bevaras (t.ex. `view`). */
  params?: Record<string, string>;
}) {
  return (
    <div className="mx-flex mx-gap-2 mx-wrap" role="group" aria-label="Period">
      {PERIOD_OPTIONS.map((opt) => {
        const qs = new URLSearchParams({ ...params, days: String(opt) });
        const active = opt === days;
        return (
          <Link
            key={opt}
            href={`${basePath}?${qs.toString()}`}
            className={`mx-chip mx-mono${active ? ' mx-ink-chip' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {opt} dgr
          </Link>
        );
      })}
    </div>
  );
}

export function formatPct(value: number, decimals = 0): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE').format(value);
}

/**
 * Delta-pill (förändring mot föregående period). Movexum saknar röd —
 * negativ förändring renderas i orange (CLAUDE.md § 2.3).
 */
export function DeltaChip({ delta }: { delta: number }) {
  const positive = delta > 0.001;
  const negative = delta < -0.001;
  const tone = positive
    ? 'bg-movexum-pastell-gron text-movexum-morkgron'
    : negative
      ? 'bg-movexum-pastell-orange text-movexum-morkorange'
      : 'bg-canvas-muted text-foreground-subtle';
  const arrow = positive ? '↑' : negative ? '↓' : '→';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title="Jämfört med föregående period"
    >
      <span aria-hidden>{arrow}</span>
      {formatPct(Math.abs(delta))}
    </span>
  );
}
