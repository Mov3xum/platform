import type { ToolRunStatus } from '@platform/shared';

// Status-presentation för uppdrag i Verktyg-tab och ArtefactDrawer.
// Matchar designens ASSIGN_STATUS-map.
export interface AssignStatusVisual {
  label: string;
  bgClass: string;
  fgClass: string;
  iconName: AssignStatusIcon;
}

export type AssignStatusIcon =
  | 'inbox'
  | 'hourglass'
  | 'badge-check'
  | 'check'
  | 'alert'
  | 'x';

export const ASSIGN_STATUS: Record<string, AssignStatusVisual> = {
  assigned: {
    label: 'Tilldelad',
    bgClass: 'bg-movexum-pastell-bla',
    fgClass: 'text-brand',
    iconName: 'inbox'
  },
  in_progress: {
    label: 'Pågående',
    bgClass: 'bg-movexum-pastell-gul',
    fgClass: 'text-movexum-morkgul',
    iconName: 'hourglass'
  },
  ready_for_review: {
    label: 'Att granska',
    bgClass: 'bg-movexum-pastell-lila',
    fgClass: 'text-movexum-lila',
    iconName: 'badge-check'
  },
  approved: {
    label: 'Godkänt',
    bgClass: 'bg-movexum-pastell-gron',
    fgClass: 'text-movexum-gron',
    iconName: 'check'
  },
  rejected: {
    label: 'Begärt ändring',
    bgClass: 'bg-movexum-pastell-orange',
    fgClass: 'text-movexum-morkorange',
    iconName: 'x'
  },
  overdue: {
    label: 'Försenad',
    bgClass: 'bg-movexum-pastell-orange',
    fgClass: 'text-movexum-orange',
    iconName: 'alert'
  },
  // Legacy fallthrough
  queued: {
    label: 'Köad',
    bgClass: 'bg-canvas-muted',
    fgClass: 'text-foreground-muted',
    iconName: 'hourglass'
  },
  running: {
    label: 'Kör',
    bgClass: 'bg-movexum-pastell-bla',
    fgClass: 'text-brand',
    iconName: 'hourglass'
  },
  succeeded: {
    label: 'Klart',
    bgClass: 'bg-movexum-pastell-gron',
    fgClass: 'text-movexum-gron',
    iconName: 'check'
  },
  failed: {
    label: 'Misslyckades',
    bgClass: 'bg-movexum-pastell-orange',
    fgClass: 'text-movexum-orange',
    iconName: 'alert'
  }
};

export function statusFor(status: ToolRunStatus, isOverdue: boolean): AssignStatusVisual {
  if (isOverdue && status !== 'approved') return ASSIGN_STATUS.overdue;
  return ASSIGN_STATUS[status] || ASSIGN_STATUS.assigned;
}

// Logg-typ-presentation för Logg-tabben.
export interface LogKindVisual {
  label: string;
  iconName: string;
  fgClass: string;
}

export const LOG_KIND: Record<string, LogKindVisual> = {
  assignment: { label: 'Tilldelning', iconName: 'inbox', fgClass: 'text-brand' },
  tool_run: { label: 'AI-körning', iconName: 'sparkle', fgClass: 'text-movexum-lila' },
  chat: { label: 'Chat', iconName: 'sparkle', fgClass: 'text-brand' },
  milestone: { label: 'Milstolpe', iconName: 'check', fgClass: 'text-movexum-gron' },
  meeting: { label: 'Möte', iconName: 'people', fgClass: 'text-foreground-muted' },
  note: { label: 'Anteckning', iconName: 'doc', fgClass: 'text-foreground-muted' },
  irl: { label: 'IRL-rörelse', iconName: 'graph', fgClass: 'text-movexum-gron' },
  approval: { label: 'Godkännande', iconName: 'badge-check', fgClass: 'text-movexum-gron' },
  phase: { label: 'Fas-skifte', iconName: 'compass', fgClass: 'text-brand' },
  kompass: { label: 'Kompassen', iconName: 'compass', fgClass: 'text-movexum-lila' },
  onboarding: { label: 'Onboarding', iconName: 'plus', fgClass: 'text-foreground-muted' },
  manual: { label: 'Aktivitet', iconName: 'dot', fgClass: 'text-foreground-muted' }
};

export function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const min = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  if (min < 1) return 'just nu';
  if (min < 60) return `för ${min} min`;
  if (hours < 24) return `för ${hours} tim`;
  if (days === 1) return 'i går';
  if (days < 7) return `för ${days} dgr`;
  if (days < 30) return `för ${Math.round(days / 7)} veckor`;
  return d.toLocaleDateString('sv-SE');
}

export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatDeadline(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
