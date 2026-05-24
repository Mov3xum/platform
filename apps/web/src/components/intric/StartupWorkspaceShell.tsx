'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import type { StartupPhase } from '@platform/shared';

interface StartupHeader {
  id: string;
  name: string;
  phase?: StartupPhase | string;
  industry?: string;
  coachName?: string;
}

interface Props {
  startup: StartupHeader;
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  activeTabBadges?: Partial<Record<TabId, number>>;
}

type TabId = 'overview' | 'chat' | 'verktyg' | 'logg';

const TABS: { id: TabId; label: string; path: string }[] = [
  { id: 'overview', label: 'Översikt', path: '' },
  { id: 'chat', label: 'Chat', path: '/chat' },
  { id: 'verktyg', label: 'Verktyg', path: '/verktyg' },
  { id: 'logg', label: 'Logg', path: '/logg' }
];

function deriveActiveTab(pathname: string, startupId: string): TabId {
  const base = `/startups/${startupId}`;
  if (pathname.startsWith(`${base}/chat`)) return 'chat';
  if (pathname.startsWith(`${base}/verktyg`)) return 'verktyg';
  if (pathname.startsWith(`${base}/logg`)) return 'logg';
  return 'overview';
}

export function StartupWorkspaceShell({
  startup,
  children,
  rightPanel,
  activeTabBadges
}: Props) {
  const pathname = usePathname();
  const activeTab = deriveActiveTab(pathname, startup.id);

  return (
    <div className={`mx-workspace ${rightPanel ? 'mx-with-right' : ''}`}>
      <div className="mx-workspace-main">
        <div className="mx-startup-head">
          <div className="mx-startup-head-row">
            <h1 className="mx-startup-title">{startup.name}</h1>
            {startup.phase && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-medium text-movexum-lila">
                <Icon name="target" size={11} /> {String(startup.phase)}
              </span>
            )}
            {startup.industry && (
              <span className="inline-flex items-center rounded-md border border-default bg-canvas-muted px-2 py-0.5 text-[11px] text-foreground-muted">
                {startup.industry}
              </span>
            )}
            {startup.coachName && (
              <span className="hidden items-center gap-1.5 px-2 py-0.5 text-[11px] text-foreground-subtle md:inline-flex">
                <Icon name="people" size={11} /> Coach: {startup.coachName}
              </span>
            )}
          </div>

          <nav className="mx-startup-tabs" aria-label="Bolagsvyer">
            {TABS.map((t) => {
              const href = `/startups/${startup.id}${t.path}`;
              const badge = activeTabBadges?.[t.id] || 0;
              return (
                <Link
                  key={t.id}
                  href={href}
                  className={`mx-startup-tab ${activeTab === t.id ? 'mx-active' : ''}`}
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
