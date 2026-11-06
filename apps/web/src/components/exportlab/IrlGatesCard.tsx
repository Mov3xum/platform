import Link from 'next/link';
import { KTH_IRL_AXES, evaluateExportIrlGates, suggestExportReadinessFromIrl, type ExportIrlSource, type IrlProfile } from '@platform/shared';
import { Chip, ReadinessLevelBadge } from './chips';
import { card, hintClass } from './ui';

/**
 * Kopplingen till KTH IRL (§ 52.2): bolagets gällande nivåer mot Movexums
 * grindar inför en första pilotexport — deterministiskt, samma siffror som
 * modellen fick. Länkar till bolagskortet där IRL bedöms (EN källa).
 */
export function IrlGatesCard({ irl, snapshot, startupId }: { irl: ExportIrlSource | null; snapshot?: IrlProfile | null; startupId: string }) {
  const profile = irl?.profile ?? snapshot ?? null;
  const gates = evaluateExportIrlGates(profile);
  const suggested = suggestExportReadinessFromIrl(profile);
  const stale = Boolean(snapshot && irl && JSON.stringify(snapshot) !== JSON.stringify(irl.profile));
  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Framdrift enligt KTH IRL</h2>
          <p className={`mt-1 ${hintClass}`}>
            {profile ? `Gällande bedömning${irl?.assessedAt ? ` ${irl.assessedAt}` : ''} mot Movexums riktvärden inför en första pilotexport.` : 'Ingen IRL-bedömning finns på bolagskortet — analysen körs utan IRL och säger det.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-subtle">IRL föreslår</span>
          <ReadinessLevelBadge level={suggested} />
        </div>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {gates.map((g) => {
          const axis = KTH_IRL_AXES.find((a) => a.key === g.axis);
          return (
            <li key={g.axis} className="rounded-xl bg-canvas-subtle p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {axis?.short} · {axis?.label}
                </span>
                <Chip tone={g.met === null ? 'neutral' : g.met ? 'green' : 'yellow'}>{g.met === null ? 'Ej bedömd' : `${g.level} / ${g.threshold}`}</Chip>
              </div>
              <p className="mt-1 text-xs text-foreground-muted">{g.why}</p>
            </li>
          );
        })}
      </ul>
      <p className={`mt-3 ${hintClass}`}>
        {stale ? 'IRL har bedömts på nytt sedan analysen kördes — en ny version väger in de nya nivåerna. ' : ''}
        IRL bedöms på{' '}
        <Link href={`/startups/${startupId}/utveckling#irl`} className="underline">
          bolagskortet
        </Link>
        ; riktvärdena är coachande, inte spärrar.
      </p>
    </section>
  );
}
