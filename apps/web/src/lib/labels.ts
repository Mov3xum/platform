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
