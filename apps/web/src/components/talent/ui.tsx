import type { ReactNode } from 'react';
import {
  STUDENT_PROFILE_STATUS_LABELS,
  TALENT_INTEREST_STATUS_LABELS,
  TALENT_NEED_KIND_LABELS,
  TALENT_NEED_STATUS_LABELS,
  type StudentProfileStatus,
  type TalentInterestStatus,
  type TalentNeedKind,
  type TalentNeedStatus
} from '@platform/shared';

/** Delade presentationsbitar för Studenter & talang (§ 54) — bara semantiska tokens, Movexums statusfärger (aldrig röd). */

export const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
export const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
export const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
export const btnDanger =
  'inline-flex items-center gap-1.5 rounded-full border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-1.5 text-sm font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange/70 disabled:opacity-60 dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';

const CHIP = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold';
const TONE = {
  neutral: 'border border-default bg-canvas-subtle text-foreground-muted',
  info: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla',
  success: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  warning: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  danger: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  accent: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila'
} as const;

export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`${CHIP} ${TONE[tone]}`}>{children}</span>;
}

const NEED_TONE: Record<TalentNeedStatus, keyof typeof TONE> = {
  draft: 'neutral',
  pending_review: 'warning',
  published: 'success',
  paused: 'warning',
  closed: 'neutral'
};
export function NeedStatusChip({ status }: { status: TalentNeedStatus }) {
  return <Chip tone={NEED_TONE[status]}>{TALENT_NEED_STATUS_LABELS[status]}</Chip>;
}

const INTEREST_TONE: Record<TalentInterestStatus, keyof typeof TONE> = {
  proposed: 'accent',
  new: 'info',
  dialogue: 'warning',
  matched: 'success',
  declined: 'danger',
  withdrawn: 'neutral'
};
export function InterestStatusChip({ status }: { status: TalentInterestStatus }) {
  return <Chip tone={INTEREST_TONE[status]}>{TALENT_INTEREST_STATUS_LABELS[status]}</Chip>;
}

const STUDENT_TONE: Record<StudentProfileStatus, keyof typeof TONE> = {
  pending: 'warning',
  active: 'success',
  paused: 'neutral',
  withdrawn: 'danger'
};
export function StudentStatusChip({ status }: { status: StudentProfileStatus }) {
  return <Chip tone={STUDENT_TONE[status]}>{STUDENT_PROFILE_STATUS_LABELS[status]}</Chip>;
}

export function KindChip({ kind }: { kind: TalentNeedKind }) {
  return <Chip tone="accent">{TALENT_NEED_KIND_LABELS[kind]}</Chip>;
}

export function TagChips({ tags, highlight }: { tags: readonly string[]; highlight?: ReadonlySet<string> }) {
  if (tags.length === 0) return <span className="text-xs text-foreground-subtle">Inga hashtags</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            highlight?.has(t)
              ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
              : 'border border-default bg-canvas-subtle text-foreground-muted'
          }`}
        >
          #{t}
        </span>
      ))}
    </span>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'warning' | 'notice'; children: ReactNode }) {
  const tone =
    kind === 'error'
      ? 'border-movexum-orange/40 bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange'
      : kind === 'warning'
        ? 'border-movexum-gul/40 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
        : 'border-movexum-gron/40 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron';
  return <div className={`rounded-xl border px-3 py-2 text-sm ${tone}`}>{children}</div>;
}

export function Panel({ title, meta, actions, children, id }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {meta}
        <span className="flex-1" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export function fmtDate(v?: string | null): string {
  return v ? v.slice(0, 10) : '–';
}
