import {
  EXPORT_ASSESSMENT_STATUS_LABELS,
  EXPORT_COMPANY_STATUS_LABELS,
  EXPORT_DIMENSION_STATUS_LABELS,
  EXPORT_DISTANCE_LABELS,
  EXPORT_INFORMATION_STATUS_LABELS,
  EXPORT_MARKET_PRIORITY_LABELS,
  EXPORT_PATHWAY_LABELS,
  EXPORT_PRIORITY_LABELS,
  getExportReadinessLabel,
  type ExportAssessmentStatus,
  type ExportCompanyStatus,
  type ExportDimensionStatus,
  type ExportDistance,
  type ExportInformationStatus,
  type ExportMarketPriority,
  type ExportPathway,
  type ExportPriority
} from '@platform/shared';

/** Statusfärger ur Movexums palett (grön/gul/orange/lila/blå — aldrig röd, § 2.3). */
const TONE = {
  green: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  yellow: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  orange: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  purple: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  blue: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  blueStrong: 'bg-movexum-djupbla text-movexum-vit dark:bg-movexum-bla dark:text-movexum-morkbla',
  neutral: 'bg-canvas-muted text-foreground-muted'
} as const;
export type ChipTone = keyof typeof TONE;

export function Chip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'risk' | 'info' | 'neutral'; children: React.ReactNode }) {
  const map: Record<string, ChipTone> = { good: 'green', warn: 'yellow', risk: 'orange', info: 'blue', neutral: 'neutral' };
  return <Chip tone={map[tone]}>{children}</Chip>;
}

const COMPANY_TONE: Record<ExportCompanyStatus, ChipTone> = { draft: 'neutral', market_review: 'purple', info_collection: 'blue', needs_more_info: 'yellow', planned: 'green' };
export function ExportStatusChip({ status }: { status: ExportCompanyStatus | null }) {
  if (!status) return <Chip tone="neutral">Ingen analys</Chip>;
  return <Chip tone={COMPANY_TONE[status]}>{EXPORT_COMPANY_STATUS_LABELS[status]}</Chip>;
}

const ASSESSMENT_TONE: Record<ExportAssessmentStatus, ChipTone> = {
  profile_pending: 'neutral',
  market_review: 'purple',
  info_pending: 'blue',
  needs_more_info: 'yellow',
  plan_pending: 'blue',
  complete: 'green',
  failed: 'orange'
};
export function ExportAssessmentStatusChip({ status }: { status: ExportAssessmentStatus }) {
  return <Chip tone={ASSESSMENT_TONE[status]}>{EXPORT_ASSESSMENT_STATUS_LABELS[status]}</Chip>;
}

/** Exportmognad: Utforskar neutral, Förbereder gul, Pilot blå, Etablerar/Skalar gröna. */
export function ReadinessLevelBadge({ level }: { level?: string | null }) {
  const label = getExportReadinessLabel(level);
  const tone: ChipTone = !label ? 'neutral' : level === 'EXPLORE' ? 'neutral' : level === 'PREPARE' ? 'yellow' : level === 'PILOT' ? 'blue' : 'green';
  return <Chip tone={tone}>{label ?? 'Ej bedömt'}</Chip>;
}

export function PathwayChip({ pathway }: { pathway: ExportPathway }) {
  return <Chip tone="purple">{EXPORT_PATHWAY_LABELS[pathway]}</Chip>;
}

const PRIORITY_TONE: Record<ExportMarketPriority, ChipTone> = { PRIMARY: 'blueStrong', SECONDARY: 'blue', LATER: 'neutral', EXCLUDED: 'orange' };
export function MarketPriorityChip({ priority }: { priority: ExportMarketPriority }) {
  return <Chip tone={PRIORITY_TONE[priority]}>{EXPORT_MARKET_PRIORITY_LABELS[priority]}</Chip>;
}

export function MarketCodeBadge({ code }: { code: string }) {
  return <span className="inline-flex shrink-0 items-center rounded border border-movexum-bla/40 bg-movexum-pastell-bla px-2 py-0.5 text-xs font-semibold text-movexum-djupbla mx-tnum dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">{code}</span>;
}

export function DimensionStatusChip({ status }: { status: ExportDimensionStatus }) {
  const tone: ChipTone = status === 'READY' ? 'green' : status === 'PARTIAL' ? 'yellow' : 'orange';
  return <Chip tone={tone}>{EXPORT_DIMENSION_STATUS_LABELS[status]}</Chip>;
}

export function DistanceChip({ distance, label }: { distance: ExportDistance; label?: string }) {
  const tone: ChipTone = distance === 'LOW' ? 'green' : distance === 'MEDIUM' ? 'yellow' : 'orange';
  return (
    <Chip tone={tone}>
      {label ? `${label}: ` : ''}
      {EXPORT_DISTANCE_LABELS[distance]}
    </Chip>
  );
}

export function PriorityChip({ grade, positive }: { grade: ExportPriority; positive?: boolean }) {
  const tone: ChipTone = positive ? (grade === 'HIGH' ? 'green' : grade === 'MEDIUM' ? 'blue' : 'neutral') : grade === 'HIGH' ? 'orange' : grade === 'MEDIUM' ? 'yellow' : 'neutral';
  return <Chip tone={tone}>{EXPORT_PRIORITY_LABELS[grade]}</Chip>;
}

export function InformationStatusChip({ status }: { status: ExportInformationStatus }) {
  const tone: ChipTone = status === 'SUFFICIENT' ? 'green' : status === 'PARTIAL' ? 'yellow' : 'orange';
  return <Chip tone={tone}>{EXPORT_INFORMATION_STATUS_LABELS[status]}</Chip>;
}
