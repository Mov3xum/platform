import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { Icon } from '@/components/proto';
import { getProcurement, listCalloffs, todayKey } from '@/lib/procurements/data';
import { AlertChip, ExcellenceChip, PhaseChip, fmtDate } from '@/app/upphandlingar/ui';
import { calloffAlerts, calloffPhase } from '@platform/shared';

/**
 * Bolagskortets vy över bolagets avrop (§ 39): vilka upphandlingar/
 * excellens-insatser bolaget omfattas av, var de står (fas), avvikelser och
 * länk till upphandlingen. Läses med användarens token → staff/observer-RLS;
 * en ren bolagsmedlem får tom lista och sektionen visas inte.
 */
export async function StartupProcurementsSection({
  pb,
  tenantId,
  startupId
}: {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
}) {
  const calloffs = await listCalloffs(pb, tenantId, { startupId });
  if (calloffs.length === 0) return null;
  const today = todayKey();
  const procurementIds = [...new Set(calloffs.map((c) => c.procurement))];
  const procurements = new Map(
    (await Promise.all(procurementIds.map((id) => getProcurement(pb, tenantId, id)))).filter(Boolean).map((p) => [p!.id, p!])
  );

  return (
    <section id="upphandlingar" className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Upphandlingar & excellens-insatser</h2>
        <Link
          href="/upphandlingar"
          className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          Alla upphandlingar <Icon name="external" size={14} />
        </Link>
      </div>
      <ul className="divide-y divide-default">
        {calloffs.map((c) => {
          const p = procurements.get(c.procurement);
          const phase = calloffPhase(c, today);
          const alerts = calloffAlerts(c, today);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/upphandlingar/${c.procurement}`} className="font-medium text-foreground hover:underline">
                  {p?.title ?? 'Upphandling'}
                </Link>
                {c.title && <span className="text-foreground-muted"> — {c.title}</span>}
                <div className="mt-0.5 text-xs text-foreground-subtle mx-tnum">
                  {p?.supplier ? `${p.supplier} · ` : ''}
                  {fmtDate(c.started_at)} – {fmtDate(c.ends_at)}
                  {c.evaluation_score !== null && c.evaluation_score !== undefined ? ` · betyg ${c.evaluation_score.toFixed(1)} / 5` : ''}
                </div>
              </div>
              <PhaseChip phase={phase} />
              {(c.is_excellence_activity ?? p?.is_excellence_activity) && <ExcellenceChip />}
              {alerts.map((a) => (
                <AlertChip key={a.kind} label={a.label} />
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
