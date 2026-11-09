import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { Icon } from '@/components/proto';
import { listApplications, listCheckTypes, todayKey, typesById } from '@/lib/support-checks/data';
import { listFundingProjects } from '@/lib/funding/data';
import { BasisChip, PhaseChip, fmtDate, fmtSek } from '@/app/checkar/ui';
import { grantedAmount, summarizeSupportChecks, supportCheckNextStep, supportCheckPhase } from '@platform/shared';

const WHO_LABEL: Record<string, string> = { applicant: 'bolaget', coach: 'coachen', controller: 'controllern', lead: 'ledningen', none: '' };

/**
 * Bolagskortets sektion "Stöd & checkar" (§ 46.7): läser live ur
 * ansökningarna (ingen kopia) — beviljat/utbetalt, öppna ärenden, vad som
 * väntas och av vem, projekt och stödgrund. Reads med användarens token →
 * RLS: bolagsmedlem ser bara sitt bolag (finansieringsblocket visas bara för
 * staff). Renderas inte alls utan ansökningar (men med länk att söka).
 */
export async function StartupSupportChecksSection({
  pb,
  tenantId,
  startupId,
  isStaff,
  canApply
}: {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
  isStaff: boolean;
  canApply: boolean;
}) {
  const [apps, types, projects] = await Promise.all([
    listApplications(pb, tenantId, { startupId }),
    listCheckTypes(pb, tenantId),
    isStaff ? listFundingProjects(pb, tenantId) : Promise.resolve([])
  ]);
  const activeTypes = types.filter((t) => t.active !== false);
  if (apps.length === 0 && !(canApply && activeTypes.length > 0)) return null;
  const today = todayKey();
  const byType = typesById(types);
  const summary = summarizeSupportChecks(apps, byType, today);
  const projectName = new Map(projects.map((p) => [p.id, p.title]));

  return (
    <section id="stodcheckar" className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Stöd & checkar</h2>
        <div className="flex flex-wrap gap-2">
          {canApply && activeTypes.length > 0 && (
            <Link href={`/checkar/ny?bolag=${startupId}`} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover">
              <Icon name="plus" size={13} /> Ny ansökan
            </Link>
          )}
          {isStaff && (
            <Link href={`/checkar?bolag=${startupId}`} className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle">
              Alla checkar <Icon name="external" size={14} />
            </Link>
          )}
        </div>
      </div>
      {apps.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Beviljat totalt" value={fmtSek(summary.grantedSek)} />
          <Stat label="Utbetalt" value={fmtSek(summary.paidSek)} />
          <Stat label="Pågående ärenden" value={String(summary.open)} />
          <Stat label="Väntar på bolaget" value={String(summary.awaitingCompany)} hint={summary.overdue > 0 ? `${summary.overdue} försenade` : undefined} />
        </div>
      )}
      {apps.length === 0 ? (
        <p className="text-sm text-foreground-subtle">Inga ansökningar än.</p>
      ) : (
        <ul className="divide-y divide-default">
          {apps.map((a) => {
            const type = byType.get(a.check_type);
            const phase = supportCheckPhase(a, type, today);
            const next = supportCheckNextStep(a, phase);
            const granted = grantedAmount(a);
            return (
              <li key={a.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/checkar/${a.id}`} className="font-medium text-foreground hover:underline">
                    {a.title || type?.title || 'Ansökan'}
                  </Link>
                  <span className="text-xs text-foreground-subtle">{type?.title}</span>
                  <PhaseChip phase={phase} />
                  {isStaff && <BasisChip basis={a.state_aid_basis} />}
                  <span className="flex-1" />
                  <span className="text-foreground-muted mx-tnum">{granted > 0 ? `${fmtSek(granted)} beviljat` : `${fmtSek(a.requested_amount_sek)} sökt`}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-foreground-subtle">
                  {next.who !== 'none' && (
                    <span>
                      Nästa: {next.label} ({WHO_LABEL[next.who]})
                    </span>
                  )}
                  {a.submitted_at && <span>inskickad {fmtDate(a.submitted_at)}</span>}
                  {isStaff && a.funding_project && <span>{projectName.get(a.funding_project) ?? 'projekt'}</span>}
                  {a.activities.length > 0 && <span>{a.activities.map((x) => x.title).filter(Boolean).slice(0, 3).join(' · ')}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-default p-3">
      <div className="text-xs uppercase tracking-wide text-foreground-subtle">{label}</div>
      <div className="mt-1 font-heading text-xl font-semibold text-foreground mx-tnum">{value}</div>
      {hint && <div className="text-xs text-foreground-muted">{hint}</div>}
    </div>
  );
}
