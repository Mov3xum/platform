'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useSyncExternalStore } from 'react';
import { coreModules } from '@platform/shared';
import { SETTINGS_ROUTE_LABELS } from '@/lib/settings-sections';
import { STATIC_ROUTE_LABELS, buildCrumbs } from '@/lib/crumbs';
import { getCrumbLabels, getServerCrumbLabels, subscribeCrumbLabels } from '@/lib/crumb-labels';
import { RailReopenButton } from './MobileRail';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';

export function ProtoTopBar({
  unseenNotifications = 0,
  notificationsHref = null
}: {
  unseenNotifications?: number;
  notificationsHref?: string | null;
} = {}) {
  const pathname = usePathname();
  // Sidornas registrerade etiketter (bolagsnamn för ett id, sidans rubrik för
  // en slug) — utan dem visas aldrig ett rått record-id (lib/crumbs.ts).
  const labels = useSyncExternalStore(subscribeCrumbLabels, getCrumbLabels, getServerCrumbLabels);
  const crumbs = useMemo(
    () => buildCrumbs(pathname, { modules: coreModules, routeLabels: { ...STATIC_ROUTE_LABELS, ...SETTINGS_ROUTE_LABELS }, labels }),
    [pathname, labels]
  );

  return (
    <div className="mx-topbar">
      <RailReopenButton />
      <div className="mx-crumb">
        {crumbs.map((c, i) => (
          <span key={c.href + i} className="mx-crumb-part">
            {i > 0 && <span className="mx-sep">/</span>}
            <Link href={c.href} className={`mx-seg${c.now ? ' now' : ''}`}>
              {c.label}
            </Link>
          </span>
        ))}
      </div>

      <div className="mx-topbar-spacer" />
      <ThemeToggle />
      <NotificationBell initialUnseen={unseenNotifications} allHref={notificationsHref} />
    </div>
  );
}
