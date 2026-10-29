import {
  IMPACT_ASSESSMENT_STATUS_LABELS,
  IMPACT_COMPANY_STATUS_LABELS,
  IMPACT_GRADE_LABELS,
  IMPACT_LEVEL_LABELS,
  type ImpactAssessmentStatus,
  type ImpactCompanyStatus,
  type ImpactGrade,
  type ImpactLevel
} from '@platform/shared';

/** Statusfärger ur Movexums palett (grön/gul/orange/lila/blå — aldrig röd, § 2.3). */
const TONE = {
  green: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  yellow: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  orange: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  purple: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  blue: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  neutral: 'bg-canvas-muted text-foreground-muted'
} as const;
type Tone = keyof typeof TONE;

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

const COMPANY_TONE: Record<ImpactCompanyStatus, Tone> = {
  draft: 'neutral',
  materiality_review: 'purple',
  info_collection: 'blue',
  needs_more_info: 'yellow',
  analyzed: 'green'
};
export function ImpactStatusChip({ status }: { status: ImpactCompanyStatus | null }) {
  if (!status) return <Chip tone="neutral">Ingen analys</Chip>;
  return <Chip tone={COMPANY_TONE[status]}>{IMPACT_COMPANY_STATUS_LABELS[status]}</Chip>;
}

const ASSESSMENT_TONE: Record<ImpactAssessmentStatus, Tone> = {
  materiality_pending: 'neutral',
  materiality_review: 'purple',
  info_pending: 'blue',
  needs_more_info: 'yellow',
  final_pending: 'blue',
  complete: 'green',
  failed: 'orange'
};
export function AssessmentStatusChip({ status }: { status: ImpactAssessmentStatus }) {
  return <Chip tone={ASSESSMENT_TONE[status]}>{IMPACT_ASSESSMENT_STATUS_LABELS[status]}</Chip>;
}

const LEVEL_TONE: Record<ImpactLevel, Tone> = { IMPACT_DRIVEN: 'green', SUSTAINABILITY_DRIVEN: 'blue', RISK_EXPOSED: 'orange' };
export function ImpactLevelChip({ level }: { level: ImpactLevel }) {
  return <Chip tone={LEVEL_TONE[level]}>{IMPACT_LEVEL_LABELS[level]}</Chip>;
}

const GRADE_TONE: Record<ImpactGrade, Tone> = { HIGH: 'orange', MEDIUM: 'yellow', LOW: 'neutral' };
export function GradeChip({ grade, positive }: { grade: ImpactGrade; positive?: boolean }) {
  const tone: Tone = positive ? (grade === 'HIGH' ? 'green' : grade === 'MEDIUM' ? 'blue' : 'neutral') : GRADE_TONE[grade];
  return <Chip tone={tone}>{IMPACT_GRADE_LABELS[grade]}</Chip>;
}
