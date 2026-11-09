import Link from 'next/link';
import type { FinancialsSource } from './types';

/** Flikens yta: scrollbar kolumn med samma luft som Aktiviteter/Verktyg. */
export function TabPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">{children}</div>
    </div>
  );
}

/** Hoppnav inom en flik (bara när fliken har flera sektioner). */
export function SectionNav({ items }: { items: Array<{ href: string; label: string; count?: number }> }) {
  return (
    <nav aria-label="Sektioner" className="flex flex-wrap gap-2 text-xs">
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className="rounded-full border border-default bg-surface px-3 py-1 font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          {it.label}
          {typeof it.count === 'number' ? <span className="ml-1 text-foreground-subtle mx-tnum">{it.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}

export function Section({
  id,
  title,
  description,
  action,
  children
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-foreground-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground-subtle">{children}</p>;
}

export function PillLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls =
    'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle';
  if (external || href.startsWith('#')) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function StatusPill({ label, variant }: { label: string; variant: 'success' | 'danger' | 'info' | 'neutral' }) {
  const classes = {
    success:
      'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
    danger:
      'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange',
    info:
      'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
    neutral: 'bg-canvas-subtle text-foreground-muted ring-default'
  }[variant];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classes}`}>
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: FinancialsSource }) {
  const cfg: Record<FinancialsSource, { label: string; className: string }> = {
    manual: { label: 'Manuell', className: 'bg-canvas-subtle text-foreground-muted' },
    import_excel: { label: 'Excel', className: 'bg-canvas-muted text-foreground-muted' },
    allabolag: {
      label: 'Allabolag',
      className: 'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla'
    },
    roaring: {
      label: 'Roaring',
      className: 'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla'
    },
    bolagsverket: {
      label: 'Bolagsverket',
      className: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/60 dark:text-movexum-pastell-lila'
    },
    other: { label: 'Övrigt', className: 'bg-canvas-subtle text-foreground-muted' }
  };
  const c = cfg[source] || cfg.other;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c.className}`}>{c.label}</span>;
}

/** En rad "avtal/godkännande": signerat (grön) eller inte, med datum. */
export function SignedRow({ label, signed, date }: { label: string; signed?: boolean; date?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {date ? <span className="text-xs text-foreground-subtle mx-tnum">{formatDate(date)}</span> : null}
        {signed ? (
          <span className="rounded-full bg-movexum-pastell-gron px-2.5 py-0.5 text-xs font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
            Klart
          </span>
        ) : (
          <span className="rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted">Ej klart</span>
        )}
      </span>
    </li>
  );
}

export function formatSek(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '–';
  return `${value.toLocaleString('sv-SE')} kr`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

export function relDays(iso?: string): string | undefined {
  if (!iso) return undefined;
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diff < 1) return 'i dag';
  if (diff === 1) return 'i går';
  if (diff < 30) return `för ${diff} dgr sedan`;
  return formatDate(iso);
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
