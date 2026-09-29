import { GOAL_STATUS_LABELS, type GoalStatus } from '@platform/shared';

/**
 * Delade presentationsbitar för målstyrningen (§ 42) — används av cockpiten
 * och presentationsläget. Färger enligt § 2.3: grön = i fas/klar,
 * gul = försenad, neutral = ej startad. Ingen röd.
 */

const STATUS_TONE: Record<GoalStatus | 'unreported', string> = {
  on_track: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  done: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  delayed: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  not_started: 'bg-canvas-muted text-foreground-muted',
  unreported: 'border border-dashed border-default text-foreground-subtle'
};

export function StatusChip({ status, small }: { status: GoalStatus | 'unreported'; small?: boolean }) {
  const label = status === 'unreported' ? 'Ej rapporterad' : GOAL_STATUS_LABELS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'} ${STATUS_TONE[status]}`}
    >
      {label}
    </span>
  );
}

