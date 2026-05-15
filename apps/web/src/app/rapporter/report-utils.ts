import type { ReportStatus, ReportSection } from '@platform/shared';

export function statusChipVariant(s: ReportStatus): 'draft' | 'review' | 'done' | 'archive' {
  switch (s) {
    case 'draft_ai':
      return 'draft';
    case 'review':
      return 'review';
    case 'sent':
      return 'done';
    case 'archived':
      return 'archive';
  }
}

export function statusLabel(s: ReportStatus): string {
  switch (s) {
    case 'draft_ai':
      return 'Utkast (AI)';
    case 'review':
      return 'Granskning';
    case 'sent':
      return 'Skickad';
    case 'archived':
      return 'Arkiverad';
  }
}

export function sectionStateChip(
  state: ReportSection['state']
): { variant: 'draft' | 'review' | 'active' | 'archive'; label: string } {
  switch (state) {
    case 'done':
      return { variant: 'active', label: 'Klar' };
    case 'review':
      return { variant: 'review', label: 'Granskas' };
    case 'auto':
      return { variant: 'review', label: 'AI-utkast' };
    case 'pending':
    default:
      return { variant: 'draft', label: 'Saknar' };
  }
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'just nu';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just nu';
  if (hours < 24) return `för ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'igår';
  if (days < 7) return `för ${days} dagar`;
  if (days < 30) return `för ${Math.floor(days / 7)}v`;
  return `för ${Math.floor(days / 30)} mån`;
}
