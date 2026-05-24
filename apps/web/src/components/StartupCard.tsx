import Link from 'next/link';
import type { StartupPhase } from '@platform/shared';
import { PhaseBadge, StatusBadge } from '@/components/Badges';
import type { StartupStatus } from '@/lib/labels';

export interface StartupCardData {
  id: string;
  name: string;
  description?: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  coachNames?: string[];
}

/** Bolagskort — kompakt översikt, klickbart till bolagsdetaljen. */
export function StartupCard({ startup, compact = false }: { startup: StartupCardData; compact?: boolean }) {
  return (
    <Link
      href={`/startups/${startup.id}`}
      className="group flex flex-col gap-2 rounded-2xl border border-default bg-surface p-4 transition hover:border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold text-foreground transition group-hover:text-link">
          {startup.name}
        </h3>
        {startup.irl_level ? (
          <span className="shrink-0 rounded-md bg-canvas-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground-muted">
            IRL {startup.irl_level}
          </span>
        ) : null}
      </div>

      {!compact && startup.description && (
        <p className="line-clamp-2 text-[12.5px] text-foreground-muted">{startup.description}</p>
      )}

      {startup.next_step && (
        <p className="line-clamp-1 text-[12px] text-foreground-subtle">
          <span className="font-medium text-foreground-muted">Nästa:</span> {startup.next_step}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <PhaseBadge phase={startup.phase} />
        <StatusBadge status={startup.status} />
        {startup.coachNames && startup.coachNames.length > 0 && (
          <span className="text-[11px] text-foreground-subtle">· {startup.coachNames.join(', ')}</span>
        )}
      </div>
    </Link>
  );
}
