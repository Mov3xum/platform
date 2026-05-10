import type { StartupPhase } from '@platform/shared';

export const phaseLabels: Record<StartupPhase, string> = {
  idea: 'Idé',
  pre_revenue: 'Före intäkter',
  early_revenue: 'Tidiga intäkter',
  growth: 'Tillväxt',
  scale: 'Skalning',
  exit: 'Exit'
};

export const phaseTokens: Record<StartupPhase, string> = {
  idea: 'var(--color-phase-idea)',
  pre_revenue: 'var(--color-phase-pre-revenue)',
  early_revenue: 'var(--color-phase-early-revenue)',
  growth: 'var(--color-phase-growth)',
  scale: 'var(--color-phase-scale)',
  exit: 'var(--color-phase-exit)'
};

export type StartupStatus = 'active' | 'alumni' | 'paused' | 'rejected';

export const statusLabels: Record<StartupStatus, string> = {
  active: 'Aktiv',
  alumni: 'Alumn',
  paused: 'Pausad',
  rejected: 'Avvisad'
};

export type ActivityType = 'meeting' | 'call' | 'email' | 'task' | 'workshop' | 'other';
export const activityTypeLabels: Record<ActivityType, string> = {
  meeting: 'Möte',
  call: 'Samtal',
  email: 'E-post',
  task: 'Uppgift',
  workshop: 'Workshop',
  other: 'Övrigt'
};

export type ActivityStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
export const activityStatusLabels: Record<ActivityStatus, string> = {
  planned: 'Planerad',
  in_progress: 'Pågår',
  done: 'Klar',
  cancelled: 'Inställd'
};

export type AgreementKind = 'nda' | 'incubator_agreement' | 'ip_assignment' | 'addendum' | 'other';
export const agreementKindLabels: Record<AgreementKind, string> = {
  nda: 'NDA',
  incubator_agreement: 'Inkubatoravtal',
  ip_assignment: 'IP-tilldelning',
  addendum: 'Tillägg',
  other: 'Övrigt'
};

export type AgreementStatus = 'draft' | 'sent' | 'signed' | 'expired' | 'terminated';
export const agreementStatusLabels: Record<AgreementStatus, string> = {
  draft: 'Utkast',
  sent: 'Skickat',
  signed: 'Signerat',
  expired: 'Utgått',
  terminated: 'Avslutat'
};

export type MilestoneCategory = 'product' | 'market' | 'team' | 'funding' | 'sustainability' | 'other';
export const milestoneCategoryLabels: Record<MilestoneCategory, string> = {
  product: 'Produkt',
  market: 'Marknad',
  team: 'Team',
  funding: 'Finansiering',
  sustainability: 'Hållbarhet',
  other: 'Övrigt'
};

export type MilestoneStatus = 'planned' | 'in_progress' | 'achieved' | 'missed';
export const milestoneStatusLabels: Record<MilestoneStatus, string> = {
  planned: 'Planerad',
  in_progress: 'Pågår',
  achieved: 'Uppnådd',
  missed: 'Missad'
};

export type ToolCategory =
  | 'ai_per_startup'
  | 'ai_system_wide'
  | 'education'
  | 'template'
  | 'checklist';

export const toolCategoryLabels: Record<ToolCategory, string> = {
  ai_per_startup: 'AI per bolag',
  ai_system_wide: 'AI portfölj',
  education: 'Utbildning',
  template: 'Mall',
  checklist: 'Checklista'
};

export type ToolRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export const toolRunStatusLabels: Record<ToolRunStatus, string> = {
  queued: 'I kö',
  running: 'Kör',
  succeeded: 'Klar',
  failed: 'Misslyckad'
};

export type ActivityKind = 'manual' | 'tool_run' | 'workshop_assignment' | 'workshop_run';
export const activityKindLabels: Record<ActivityKind, string> = {
  manual: 'Manuell',
  tool_run: 'Verktygskörning',
  workshop_assignment: 'Workshoptilldelning',
  workshop_run: 'Workshop AI-körning'
};

export type WorkshopStatus = 'draft' | 'active' | 'archived';
export const workshopStatusLabels: Record<WorkshopStatus, string> = {
  draft: 'Utkast',
  active: 'Aktiv',
  archived: 'Arkiverad'
};

export type WorkshopAssignmentStatus = 'planned' | 'in_progress' | 'done';
export const workshopAssignmentStatusLabels: Record<WorkshopAssignmentStatus, string> = {
  planned: 'Planerad',
  in_progress: 'Pågår',
  done: 'Klar'
};
