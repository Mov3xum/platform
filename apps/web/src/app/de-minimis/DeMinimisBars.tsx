import {
  forordningLabels,
  type DeMinimisRegel,
  type ForordningSummary,
  type WarningLevel
} from '@platform/shared';

// Progress-barer för de minimis: en per förordning + en samlad mot 300 000 EUR.
// Färg per varningsnivå via Tailwind-utilities (ingen inline brand-hex,
// CLAUDE.md § 4.6) — bredden är layout (tillåtet som inline style).

const fillClass: Record<WarningLevel, string> = {
  ok: 'bg-brand',
  warn: 'bg-movexum-gul',
  critical: 'bg-movexum-orange',
  over: 'bg-movexum-orange'
};

const periodLabel: Record<string, string> = {
  RULLANDE_3AR: 'Rullande 3 år',
  BESKATTNINGSAR_3: '3 beskattningsår'
};

function eur(n: number): string {
  return `${Math.round(n).toLocaleString('sv-SE')} EUR`;
}

function Bar({
  label,
  sub,
  summary,
  emphasis = false
}: {
  label: string;
  sub?: string;
  summary: ForordningSummary;
  emphasis?: boolean;
}) {
  const over = summary.level === 'over';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={emphasis ? 'text-sm font-semibold text-foreground' : 'text-sm font-medium text-foreground'}>
          {label}
          {sub ? <span className="ml-1.5 font-mono text-[11px] text-foreground-subtle">{sub}</span> : null}
        </span>
        <span className="font-mono text-xs text-foreground-muted">
          {eur(summary.used)} / {eur(summary.cap)}
        </span>
      </div>
      <div className={`h-2.5 w-full overflow-hidden rounded-full ${emphasis ? 'bg-canvas-muted' : 'bg-canvas-subtle'}`}>
        <div
          className={`h-full rounded-full ${fillClass[summary.level]} transition-[width]`}
          style={{ width: `${Math.max(2, Math.min(100, summary.pct))}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={over ? 'font-medium text-movexum-morkorange dark:text-movexum-orange' : 'text-foreground-subtle'}>
          {over
            ? `Taket överskridet med ${eur(Math.abs(summary.remaining))}`
            : `Kvar: ${eur(summary.remaining)}`}
        </span>
        <span className="text-foreground-subtle">{periodLabel[summary.period] ?? ''}</span>
      </div>
    </div>
  );
}

export function DeMinimisBars({
  perForordning,
  samlat,
  regelverk
}: {
  perForordning: ForordningSummary[];
  samlat: ForordningSummary;
  regelverk: DeMinimisRegel[];
}) {
  return (
    <div className="space-y-5">
      <Bar
        label="Samlad summa"
        sub="(alla förordningar)"
        summary={samlat}
        emphasis
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {perForordning.map((p) => {
          const regel = regelverk.find((r) => r.kod === p.kod);
          return (
            <Bar
              key={p.kod}
              label={forordningLabels[p.kod]}
              sub={regel?.forordning_text}
              summary={p}
            />
          );
        })}
      </div>
    </div>
  );
}
