import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CALLOFF_PHASE_LABELS,
  PROCUREMENT_STATUS_LABELS,
  type CalloffPhase,
  type ProcurementStatus
} from '@platform/shared';

/**
 * Små delade presentationsbitar för upphandlingsmodulen (§ 39). Bara
 * semantiska tokens + Movexums statusfärger (grön/gul/orange — aldrig röd).
 */

export const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
export const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
export const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';

const STATUS_TONE: Record<ProcurementStatus, string> = {
  planning: 'bg-canvas-muted text-foreground-muted',
  tender_open: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla',
  evaluation: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  awarded: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  active: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  ended: 'bg-canvas-muted text-foreground-subtle',
  cancelled: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange'
};

const PHASE_TONE: Record<CalloffPhase, string> = {
  planned: 'bg-canvas-muted text-foreground-muted',
  setup: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla',
  coaching: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  awaiting_report: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  awaiting_evaluation: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  done: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  cancelled: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange'
};

export function StatusChip({ status }: { status: ProcurementStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.planning}`}>
      {PROCUREMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PhaseChip({ phase }: { phase: CalloffPhase }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE_TONE[phase]}`}>
      {CALLOFF_PHASE_LABELS[phase]}
    </span>
  );
}

export function AlertChip({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-movexum-pastell-orange px-2 py-0.5 text-[11px] font-semibold text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
      {label}
    </span>
  );
}

export function ExcellenceChip() {
  return (
    <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-[11px] font-semibold text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul">
      Excellens
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

export function AiBanner() {
  return (
    <p className="text-xs text-foreground-subtle">
      AI-utläsning drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Genererat av AI – verifiera innan
      du sparar. Ladda inte upp personuppgifter.
    </p>
  );
}

export function fmtDate(v?: string | null): string {
  return v ? v.slice(0, 10) : '–';
}

export function fmtSek(v?: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm text-link hover:underline">
      ← {label}
    </Link>
  );
}
