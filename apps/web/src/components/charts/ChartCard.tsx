import type { ReactNode } from 'react';

// Tremor-inspirerade kort-primitiver, byggda direkt för Tailwind v4 + Movexums
// semantiska tokens (ingen @tremor/react-dep — den kräver Tailwind v3). Ren,
// minimalistisk look enligt grafiska profilen: rundade hörn, mjuk kant, svag
// brand-skugga; dark-mode via semantiska tokens.

const CARD = 'rounded-2xl border border-default bg-surface shadow-movexum-svart/5';

export interface ChartCardProps {
  title?: string;
  subtitle?: string;
  /** Frivillig åtgärd uppe till höger (knapp/länk/select). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, action, className, children }: ChartCardProps) {
  return (
    <section className={`${CARD} p-5 ${className ?? ''}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-sm text-foreground-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export type StatTrend = 'up' | 'down' | 'flat';

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Hjälptext under värdet (t.ex. "jämfört med förra kvartalet"). */
  hint?: string;
  /** Förändringsetikett, t.ex. "+12 %". Färgas via `trend`. */
  delta?: string;
  trend?: StatTrend;
  icon?: ReactNode;
  className?: string;
}

// Movexum saknar röd → positiv=grön, negativ=orange (profilens error-färg).
const TREND_CLASS: Record<StatTrend, string> = {
  up: 'text-movexum-gron',
  down: 'text-movexum-orange',
  flat: 'text-foreground-subtle'
};
const TREND_GLYPH: Record<StatTrend, string> = { up: '▲', down: '▼', flat: '—' };

export function StatCard({ label, value, hint, delta, trend = 'flat', icon, className }: StatCardProps) {
  return (
    <div className={`${CARD} p-5 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground-muted">{label}</p>
        {icon && <span className="text-foreground-subtle">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-heading text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        {delta && (
          <span className={`text-sm font-semibold ${TREND_CLASS[trend]}`}>
            <span aria-hidden className="mr-0.5 text-xs">
              {TREND_GLYPH[trend]}
            </span>
            {delta}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-foreground-subtle">{hint}</p>}
    </div>
  );
}
