import { requireUser } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { MovexumChart } from '@/components/charts/MovexumChart';
import { ChartCard, StatCard } from '@/components/charts/ChartCard';

// Designförhandsvisning för det nya diagram-/kort-språket (Recharts + Movexum-
// tokens). Ren demo med statisk data — ingen riktig portföljdata. Tänkt som
// referens/QA-yta; kan tas bort när komponenterna används skarpt.

export default async function DesignPreviewPage() {
  await requireUser();

  return (
    <PageShell title="Designförhandsvisning" meta="Diagram & kort — Movexums grafiska profil">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Aktiva bolag" value={12} delta="+2" trend="up" hint="jämfört med Q1" />
          <StatCard label="Total intäkt" value="11,4 MSEK" delta="+24 %" trend="up" hint="rullande 12 mån" />
          <StatCard label="Anställda" value={164} delta="+39 %" trend="up" hint="i portföljbolagen" />
          <StatCard label="Pausade" value={1} delta="-1" trend="down" hint="sedan förra kvartalet" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Intäkt per kvartal" subtitle="Jämförelse 2025 vs 2026 (MSEK)">
            <MovexumChart
              type="bar"
              unit="kr"
              categories={['Q1', 'Q2', 'Q3', 'Q4']}
              series={[
                { name: '2025', values: [8.2, 9.1, 10.4, 11.4] },
                { name: '2026', values: [9.0, 11.4, 12.2, 13.0] }
              ]}
            />
          </ChartCard>

          <ChartCard title="Aktiva bolag i portföljen" subtitle="Senaste 5 månaderna">
            <MovexumChart
              type="line"
              categories={['Jan', 'Feb', 'Mar', 'Apr', 'Maj']}
              series={[{ name: 'Bolag', values: [9, 10, 11, 12, 12] }]}
            />
          </ChartCard>

          <ChartCard title="Anställda i portföljbolagen" subtitle="Tillväxt per år">
            <MovexumChart
              type="area"
              unit="st"
              categories={['2022', '2023', '2024', '2025']}
              series={[{ name: 'Anställda', values: [40, 72, 118, 164] }]}
            />
          </ChartCard>

          <ChartCard title="Fördelning per fas" subtitle="Andel av portföljen">
            <MovexumChart
              type="pie"
              categories={['Idé', 'Tidig', 'Tillväxt', 'Skala']}
              series={[{ name: 'Bolag', values: [3, 5, 3, 1] }]}
            />
          </ChartCard>

          <ChartCard title="Intäkt per bolag" subtitle="Topp 4" className="lg:col-span-2">
            <MovexumChart
              type="hbar"
              unit="kr"
              height={260}
              categories={['Acme AB', 'Beta AB', 'Gamma AB', 'Delta AB']}
              series={[{ name: 'Intäkt', values: [1250000, 430000, 9800000, 2100000] }]}
            />
          </ChartCard>
        </div>
      </div>
    </PageShell>
  );
}
