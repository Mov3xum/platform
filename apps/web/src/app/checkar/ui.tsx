import type { ReactNode } from 'react';
import {
  FUNDING_BASIS_SHORT,
  SUPPORT_CHECK_PHASE_LABELS,
  SUPPORT_CHECK_STATUS_LABELS,
  type EligibilityCheck,
  type FundingBasis,
  type SupportCheckPhase,
  type SupportCheckStatus
} from '@platform/shared';

/**
 * Delade presentationsbitar för stödcheck-modulen (§ 46). Bara semantiska
 * tokens + Movexums statusfärger (grön/gul/orange — aldrig röd).
 */

export { AlertChip, BackLink, ExcellenceChip, Notice, Panel, btnGhost, btnPrimary, fmtDate, fmtSek, inputClass, labelClass } from '@/app/upphandlingar/ui';

const GREEN = 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron';
const YELLOW = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';
const ORANGE = 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange';
const BLUE = 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla';
const PURPLE = 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila';
const NEUTRAL = 'bg-canvas-muted text-foreground-muted';

const PHASE_TONE: Record<SupportCheckPhase, string> = {
  draft: NEUTRAL,
  awaiting_review: BLUE,
  changes_requested: YELLOW,
  changes_overdue: ORANGE,
  awaiting_controller: BLUE,
  awaiting_decision: PURPLE,
  approved_unpaid: GREEN,
  in_progress: GREEN,
  report_due: YELLOW,
  report_overdue: ORANGE,
  closed: 'bg-canvas-muted text-foreground-subtle',
  rejected: ORANGE,
  withdrawn: 'bg-canvas-muted text-foreground-subtle'
};

const STATUS_TONE: Record<SupportCheckStatus, string> = {
  draft: NEUTRAL,
  submitted: BLUE,
  changes_requested: YELLOW,
  under_review: PURPLE,
  approved: GREEN,
  rejected: ORANGE,
  paid: GREEN,
  closed: 'bg-canvas-muted text-foreground-subtle',
  withdrawn: 'bg-canvas-muted text-foreground-subtle'
};

export function PhaseChip({ phase }: { phase: SupportCheckPhase }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE_TONE[phase] ?? NEUTRAL}`}>{SUPPORT_CHECK_PHASE_LABELS[phase] ?? phase}</span>;
}

export function StatusChip({ status }: { status: SupportCheckStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status] ?? NEUTRAL}`}>{SUPPORT_CHECK_STATUS_LABELS[status] ?? status}</span>;
}

export function BasisChip({ basis }: { basis: FundingBasis | null | undefined }) {
  if (!basis) return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${NEUTRAL}`}>Stödgrund ej satt</span>;
  const tone = basis === 'de_minimis' ? PURPLE : basis === 'art22' ? BLUE : NEUTRAL;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{FUNDING_BASIS_SHORT[basis]}</span>;
}

export function EligibilityChip({ check }: { check: EligibilityCheck }) {
  const tone = check.status === 'ok' ? GREEN : check.status === 'fail' ? ORANGE : check.status === 'n/a' ? NEUTRAL : YELLOW;
  const mark = check.status === 'ok' ? '✓' : check.status === 'fail' ? '✕' : check.status === 'n/a' ? '–' : '?';
  return (
    <span title={check.detail} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      <span aria-hidden>{mark}</span> {check.label}
    </span>
  );
}

export function KpiRow({ items }: { items: Array<{ label: string; value: ReactNode; hint?: string }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-2xl border border-default bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-foreground-subtle">{k.label}</div>
          <div className="mt-1 font-heading text-2xl font-semibold text-foreground mx-tnum">{k.value}</div>
          {k.hint && <div className="mt-1 text-xs text-foreground-muted">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground-subtle">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
