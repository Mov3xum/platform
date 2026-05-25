'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/proto/Icon';

export interface PageTab {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

interface Props {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: PageTab[];
  rightPanel?: ReactNode;
  /** Slå av intern scroll-kontainer om innehållet redan hanterar scroll. */
  scroll?: boolean;
  /** Slå av default-padding kring children. */
  noPad?: boolean;
  children: ReactNode;
}

function tabMatches(pathname: string, href: string) {
  if (href === pathname) return true;
  if (href === '/') return false;
  return pathname.startsWith(href + '/');
}

/**
 * Returnerar den href som ska markeras aktiv. När flera flikar matchar
 * (t.ex. en rot-flik "/startups" och en underflik "/startups/inkubator")
 * vinner den mest specifika (längsta) matchningen så att bara en flik blir
 * aktiv.
 */
function resolveActiveTab(pathname: string, tabs: PageTab[]): string | null {
  let best: string | null = null;
  for (const t of tabs) {
    if (tabMatches(pathname, t.href) && (best === null || t.href.length > best.length)) {
      best = t.href;
    }
  }
  return best;
}

export function PageShell({
  title,
  meta,
  actions,
  tabs,
  rightPanel,
  scroll = true,
  noPad = false,
  children
}: Props) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(true);
  const hasRail = Boolean(rightPanel);
  const hasHead =
    Boolean(title) || (tabs && tabs.length > 0) || Boolean(actions) || Boolean(meta);

  return (
    <div className={`mx-page ${hasRail && railOpen ? 'mx-with-right' : ''}`}>
      <div className="mx-page-main">
        {hasHead && (
          <header className="mx-page-shell-head">
            <div className="mx-page-shell-head-row">
              <h1 className="mx-page-shell-title">{title}</h1>
              {meta}
              <span className="flex-1" />
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
              {hasRail && !railOpen && (
                <button
                  type="button"
                  onClick={() => setRailOpen(true)}
                  className="hidden h-8 w-8 items-center justify-center rounded-lg border border-default bg-surface text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground lg:flex"
                  title="Visa panel"
                  aria-label="Visa panel"
                >
                  <Icon name="panel-right" size={14} />
                </button>
              )}
            </div>

            {tabs && tabs.length > 0 && (
              <nav className="mx-startup-tabs" aria-label="Vyer">
                {(() => {
                  const activeHref = resolveActiveTab(pathname, tabs);
                  return tabs.map((t) => {
                  const active = t.href === activeHref;
                  return (
                    <Link
                      key={t.id}
                      href={t.href}
                      className={`mx-startup-tab ${active ? 'mx-active' : ''}`}
                    >
                      {t.label}
                      {t.badge && t.badge > 0 ? (
                        <span className="mx-tab-badge">{t.badge}</span>
                      ) : null}
                    </Link>
                  );
                  });
                })()}
              </nav>
            )}
          </header>
        )}

        <div
          className={`flex min-h-0 flex-1 flex-col ${scroll ? 'overflow-y-auto' : 'overflow-hidden'} ${noPad ? '' : 'mx-page-body'}`}
        >
          {children}
        </div>
      </div>

      {hasRail && railOpen && (
        <aside className="mx-workspace-aside flex flex-col">
          <div className="flex items-center justify-end px-3 py-2">
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
              title="Stäng"
              aria-label="Stäng panel"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-4">{rightPanel}</div>
        </aside>
      )}
    </div>
  );
}
