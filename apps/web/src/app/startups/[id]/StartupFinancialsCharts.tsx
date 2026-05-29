'use client';

import { MovexumChart } from '@/components/charts/MovexumChart';
import { ChartCard, StatCard, type StatTrend } from '@/components/charts/ChartCard';

// KPI-kort + trenddiagram för ett bolags finansiella historik. Rendrar
// StartupFinancials-rader (årsvis) med Movexums diagram-/kortspråk. Ren
// presentation — ingen datahämtning här (server-sidan skickar in raderna).

interface FinRow {
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
}

function compactSek(v?: number): string {
  if (v == null) return '–';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} Mkr`;
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} tkr`;
  return `${v.toLocaleString('sv-SE')} kr`;
}

function pctDelta(curr?: number, prev?: number): { label?: string; trend: StatTrend } {
  if (curr == null || prev == null || prev === 0) return { trend: 'flat' };
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { label: '±0 %', trend: 'flat' };
  const sign = pct > 0 ? '+' : '';
  return { label: `${sign}${pct.toLocaleString('sv-SE', { maximumFractionDigits: 0 })} %`, trend: pct > 0 ? 'up' : 'down' };
}

function absDelta(curr?: number, prev?: number): { label?: string; trend: StatTrend } {
  if (curr == null || prev == null) return { trend: 'flat' };
  const d = curr - prev;
  if (d === 0) return { label: '±0', trend: 'flat' };
  return { label: `${d > 0 ? '+' : ''}${d.toLocaleString('sv-SE')}`, trend: d > 0 ? 'up' : 'down' };
}

export function StartupFinancialsCharts({ rows }: { rows: FinRow[] }) {
  // Stigande kronologi för trend (server skickar fallande).
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
  const categories = sorted.map((r) => String(r.year));

  const revDelta = pctDelta(latest.revenue_sek, prev?.revenue_sek);
  const empDelta = absDelta(latest.employees, prev?.employees);
  const pcDelta = pctDelta(latest.personnel_cost_sek, prev?.personnel_cost_sek);

  const hasRevenue = sorted.some((r) => r.revenue_sek != null);
  const hasEmployees = sorted.some((r) => r.employees != null);
  const hasPersonnel = sorted.some((r) => r.personnel_cost_sek != null);

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label={`Omsättning ${latest.year}`}
          value={compactSek(latest.revenue_sek)}
          delta={revDelta.label}
          trend={revDelta.trend}
          hint={prev ? `mot ${prev.year}` : undefined}
        />
        <StatCard
          label={`Anställda ${latest.year}`}
          value={latest.employees ?? '–'}
          delta={empDelta.label}
          trend={empDelta.trend}
          hint={prev ? `mot ${prev.year}` : undefined}
        />
        <StatCard
          label={`Personalkostnad ${latest.year}`}
          value={compactSek(latest.personnel_cost_sek)}
          delta={pcDelta.label}
          trend={pcDelta.trend}
          hint={prev ? `mot ${prev.year}` : undefined}
        />
      </div>

      {(hasRevenue || hasPersonnel) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {hasRevenue && (
            <ChartCard title="Omsättning per år">
              <MovexumChart
                type="bar"
                unit="kr"
                height={260}
                categories={categories}
                series={[{ name: 'Omsättning', values: sorted.map((r) => r.revenue_sek ?? 0) }]}
              />
            </ChartCard>
          )}
          {hasEmployees && (
            <ChartCard title="Anställda per år">
              <MovexumChart
                type="line"
                unit="st"
                height={260}
                categories={categories}
                series={[{ name: 'Anställda', values: sorted.map((r) => r.employees ?? 0) }]}
              />
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
