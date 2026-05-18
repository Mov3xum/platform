import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/proto/Icon';

/* ─────────────────────────────────────────────────────────────
   Reusable building blocks for the right-rail of PageShell.
   Komposera dem fritt per sida — varje sida bygger sin egen
   kontext (filter, snabb-data, navigation, etc.).
   ───────────────────────────────────────────────────────────── */

export function RailSection({
  label,
  action,
  children
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-default px-3 pb-3 pt-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          {label}
        </span>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

export function RailItem({
  icon,
  iconTone = 'neutral',
  title,
  meta,
  trailing,
  href,
  onClick
}: {
  icon?: string;
  iconTone?: 'neutral' | 'brand' | 'accent' | 'success' | 'warning';
  title: string;
  meta?: string;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: 'bg-canvas-muted text-foreground-muted',
    brand: 'bg-movexum-pastell-bla text-brand dark:bg-[#001825] dark:text-[#4fc4ea]',
    accent: 'bg-movexum-pastell-lila text-movexum-lila dark:bg-[#1f1a3d] dark:text-[#c9b6fb]',
    success: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-[#152916] dark:text-[#88b48b]',
    warning: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-[#2e150a] dark:text-[#ca9323]'
  }[iconTone];

  const inner = (
    <>
      {icon && (
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}
        >
          <Icon name={icon} size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-foreground">{title}</span>
        {meta && (
          <span className="block truncate text-[11px] text-foreground-subtle">{meta}</span>
        )}
      </span>
      {trailing}
    </>
  );

  const cls =
    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-canvas-muted';

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls + ' cursor-default'}>{inner}</div>;
}

export function RailStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-default bg-canvas-subtle px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-foreground-subtle">{hint}</div>}
    </div>
  );
}

export function RailEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-6 text-center text-[12px] text-foreground-subtle">{children}</div>
  );
}

export function RailNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 text-[11px] leading-relaxed text-foreground-subtle">{children}</p>
  );
}
