import {
  IMPACT_ASSESSMENT_STATUS_LABELS,
  IMPACT_CATEGORY_CODE_PREFIXES,
  IMPACT_COMPANY_STATUS_LABELS,
  IMPACT_GRADE_LABELS,
  IMPACT_INFORMATION_STATUS_LABELS,
  getImpactLevelLabel,
  type ImpactAssessmentStatus,
  type ImpactCompanyStatus,
  type ImpactGrade,
  type ImpactInformationStatus,
  type ImpactPersistedCategory
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
export type ChipTone = keyof typeof TONE;

export function Chip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/** Originalets Badge-toner: good/warn/risk/info/neutral. */
export function Badge({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'risk' | 'info' | 'neutral'; children: React.ReactNode }) {
  const map: Record<string, ChipTone> = { good: 'green', warn: 'yellow', risk: 'orange', info: 'blue', neutral: 'neutral' };
  return <Chip tone={map[tone]}>{children}</Chip>;
}

const COMPANY_TONE: Record<ImpactCompanyStatus, ChipTone> = {
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

const ASSESSMENT_TONE: Record<ImpactAssessmentStatus, ChipTone> = {
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

/** Övergripande bedömning — Riskexponerad i orange, övriga nivåer gröna, saknad "Ej bedömt" (originalets ImpactLevelBadge). */
export function ImpactLevelBadge({ level }: { level?: string | null }) {
  const label = getImpactLevelLabel(level);
  const tone: ChipTone = !label ? 'neutral' : level === 'RISK_EXPOSED' ? 'orange' : 'green';
  return <Chip tone={tone}>{label ?? 'Ej bedömt'}</Chip>;
}
/** Bakåtkompatibelt namn. */
export const ImpactLevelChip = ImpactLevelBadge;

const CATEGORY_TONE: Record<ImpactPersistedCategory, string> = {
  ENVIRONMENT: 'border-movexum-gron/40 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  SOCIAL: 'border-movexum-bla/40 bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  GOVERNANCE: 'border-movexum-gul/50 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  CUSTOM: 'border-default bg-canvas-muted text-foreground-muted'
};
/** Visningskod per kategori (ENV-01 …) i kategorins färg. */
export function AspectCodeBadge({ category, code }: { category: ImpactPersistedCategory; code?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-xs font-semibold mx-tnum ${CATEGORY_TONE[category] ?? CATEGORY_TONE.CUSTOM}`}>
      {code ?? IMPACT_CATEGORY_CODE_PREFIXES[category]}
    </span>
  );
}

const GRADE_TONE: Record<ImpactGrade, ChipTone> = { HIGH: 'orange', MEDIUM: 'yellow', LOW: 'neutral' };
export function GradeChip({ grade, positive }: { grade: ImpactGrade; positive?: boolean }) {
  const tone: ChipTone = positive ? (grade === 'HIGH' ? 'green' : grade === 'MEDIUM' ? 'blue' : 'neutral') : GRADE_TONE[grade];
  return <Chip tone={tone}>{IMPACT_GRADE_LABELS[grade]}</Chip>;
}

export function InformationStatusChip({ status }: { status: ImpactInformationStatus }) {
  const tone: ChipTone = status === 'SUFFICIENT' ? 'green' : status === 'PARTIAL' ? 'yellow' : 'orange';
  return <Chip tone={tone}>{IMPACT_INFORMATION_STATUS_LABELS[status]}</Chip>;
}
