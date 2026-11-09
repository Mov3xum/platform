'use client';

/** Hopp-navigation över rapportens sektioner (§ 51.12) — samma mönster som bolagskortets SectionNav. */
export function ReportNav({ items }: { items: Array<{ href: string; label: string; count?: number }> }) {
  return (
    <nav aria-label="Rapportens sektioner" className="flex flex-wrap gap-2 text-xs">
      {items.map((it) => (
        <a key={it.href} href={it.href} className="rounded-full border border-default bg-surface px-3 py-1 font-medium text-foreground-muted transition hover:bg-canvas-subtle">
          {it.label}
          {typeof it.count === 'number' ? <span className="ml-1 text-foreground-subtle mx-tnum">{it.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}
