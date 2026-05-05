import type { StartupPhase } from '@platform/shared';
import { phaseLabels, phaseTokens, statusLabels, type StartupStatus } from '@/lib/labels';

export function PhaseBadge({ phase }: { phase: StartupPhase }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-foreground-muted"
      title={phaseLabels[phase]}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: phaseTokens[phase] }}
      />
      {phaseLabels[phase]}
    </span>
  );
}

/**
 * StatusBadge använder Movexums brand-färger:
 *   active   → grön (Movexum gron)
 *   alumni   → neutral
 *   paused   → gul (Movexum gul)
 *   rejected → orange (Movexum orange)
 */
const statusClasses: Record<StartupStatus, string> = {
  active:
    'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
  alumni:
    'bg-canvas-subtle text-foreground-muted ring-default',
  paused:
    'bg-movexum-pastell-gul text-movexum-morkgul ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul dark:ring-movexum-morkgul',
  rejected:
    'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange',
};

export function StatusBadge({ status }: { status: StartupStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusClasses[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
