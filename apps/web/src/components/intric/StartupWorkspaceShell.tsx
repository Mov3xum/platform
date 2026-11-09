'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STARTUP_TABS, activeStartupTab, type StartupTabId } from '@/lib/startup-tabs';

interface StartupHeader {
  id: string;
  name: string;
}

interface Props {
  startup: StartupHeader;
  children: React.ReactNode;
  /** Chips under namnet (fas, status, IRL …) — renderas på servern. */
  meta?: React.ReactNode;
  /** Knappar till höger om namnet (Redigera …). */
  actions?: React.ReactNode;
  rightPanel?: React.ReactNode;
  activeTabBadges?: Partial<Record<StartupTabId, number>>;
}

/**
 * Bolagskortets skal: namn + chips + åtgärder och flikarna. Flikarna och
 * sökvägarna kommer från `lib/startup-tabs.ts` (en källa — även gamla
 * ankarlänkar slås upp där).
 */
export function StartupWorkspaceShell({ startup, children, meta, actions, rightPanel, activeTabBadges }: Props) {
  const pathname = usePathname();
  const activeTab = activeStartupTab(pathname, startup.id);

  return (
    <div className={`mx-workspace ${rightPanel ? 'mx-with-right' : ''}`}>
      <div className="mx-workspace-main">
        <div className="mx-startup-head">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1">
                <Link href="/startups" className="text-xs text-foreground-subtle hover:text-foreground">
                  ← Alla bolag
                </Link>
              </div>
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{startup.name}</h1>
              {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </div>

          <nav className="mx-startup-tabs" aria-label="Bolagsvyer">
            {STARTUP_TABS.map((t) => {
              const href = `/startups/${startup.id}${t.path}`;
              const badge = activeTabBadges?.[t.id] || 0;
              return (
                <Link
                  key={t.id}
                  href={href}
                  aria-current={activeTab === t.id ? 'page' : undefined}
                  className={`mx-startup-tab whitespace-nowrap ${activeTab === t.id ? 'mx-active' : ''}`}
                >
                  {t.label}
                  {badge > 0 && <span className="mx-tab-badge">{badge}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>

      {rightPanel}
    </div>
  );
}
