import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CONTACT_CATEGORY_LABELS,
  CONTACT_REQUEST_STATUS_LABELS,
  type ContactCategory,
  type ContactRequestStatus
} from '@platform/shared';

/**
 * Små delade presentationsbitar för kontaktboken (§ 41). Bara semantiska
 * tokens + Movexums statusfärger (grön/gul/orange — aldrig röd).
 */

export const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
export const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
export const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
export const btnDanger =
  'inline-flex items-center gap-1.5 rounded-full border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-1.5 text-sm font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange/70 disabled:opacity-60 dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';

const STATUS_TONE: Record<ContactRequestStatus, string> = {
  pending: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  approved: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  declined: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  withdrawn: 'bg-canvas-muted text-foreground-subtle'
};

export function RequestStatusChip({ status }: { status: ContactRequestStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>
      {CONTACT_REQUEST_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function CategoryChip({ category }: { category: ContactCategory | null }) {
  if (!category) return null;
  return (
    <span className="inline-flex rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-semibold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
      {CONTACT_CATEGORY_LABELS[category]}
    </span>
  );
}

export function OwnerChip({ name, isMe }: { name: string; isMe?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        isMe
          ? 'bg-brand text-brand-foreground'
          : 'bg-canvas-muted text-foreground-muted'
      }`}
    >
      {name}
      {isMe ? ' (du)' : ''}
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

export function GdprBanner() {
  return (
    <p className="text-xs text-foreground-subtle">
      Kontaktboken är intern för Movexum-personal. Registrera bara personer som informerats om att uppgifterna lagras
      (GDPR). Skriv aldrig personnummer eller känsliga uppgifter i anteckningar — AI-chatten ser namn, organisation och
      roll men aldrig e-post eller telefon.
    </p>
  );
}

export function fmtDate(v?: string | null): string {
  return v ? v.slice(0, 10) : '–';
}

export function fmtDateTime(v?: string | null): string {
  if (!v) return '–';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 16);
  return d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm text-link hover:underline">
      ← {label}
    </Link>
  );
}

export function Initials({ name }: { name: string }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila font-heading text-sm font-semibold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
      {initials.toUpperCase() || '?'}
    </span>
  );
}
