import type { StartupPhase } from '@platform/shared';
import {
  phaseLabels,
  phaseTokens,
  statusLabels,
  toolCategoryLabels,
  toolRunStatusLabels,
  workshopAssignmentStatusLabels,
  workshopStatusLabels,
  type StartupStatus,
  type ToolCategory,
  type ToolRunStatus,
  type WorkshopAssignmentStatus,
  type WorkshopStatus
} from '@/lib/labels';

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

const toolCategoryClasses: Record<ToolCategory, string> = {
  ai_per_startup:
    'bg-movexum-pastell-lila text-movexum-morklila ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila dark:ring-movexum-lila',
  ai_system_wide:
    'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
  education:
    'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
  template:
    'bg-movexum-pastell-gul text-movexum-morkgul ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul dark:ring-movexum-morkgul',
  checklist:
    'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange'
};

export function ToolCategoryBadge({ category }: { category: ToolCategory }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${toolCategoryClasses[category]}`}
    >
      {toolCategoryLabels[category]}
    </span>
  );
}

const toolRunStatusClasses: Record<ToolRunStatus, string> = {
  queued: 'bg-canvas-subtle text-foreground-muted ring-default',
  running:
    'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
  succeeded:
    'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
  failed:
    'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange'
};

export function ToolRunStatusBadge({ status }: { status: ToolRunStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${toolRunStatusClasses[status]}`}
    >
      {toolRunStatusLabels[status]}
    </span>
  );
}

const workshopStatusClasses: Record<WorkshopStatus, string> = {
  draft: 'bg-canvas-subtle text-foreground-muted ring-default',
  active:
    'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
  archived:
    'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange'
};

export function WorkshopStatusBadge({ status }: { status: WorkshopStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${workshopStatusClasses[status]}`}
    >
      {workshopStatusLabels[status]}
    </span>
  );
}

const workshopAssignmentStatusClasses: Record<WorkshopAssignmentStatus, string> = {
  planned:
    'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
  in_progress:
    'bg-movexum-pastell-lila text-movexum-morklila ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila dark:ring-movexum-lila',
  done:
    'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron'
};

export function WorkshopAssignmentStatusBadge({ status }: { status: WorkshopAssignmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${workshopAssignmentStatusClasses[status]}`}
    >
      {workshopAssignmentStatusLabels[status]}
    </span>
  );
}
