'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/proto/Icon';
import { exportHref, type ExportPage } from '@/lib/export-lab/tabs';

const PAGES: ReadonlyArray<{ id: ExportPage; label: string; icon: IconName }> = [
  { id: 'plan', label: 'Exportplan', icon: 'compass' },
  { id: 'marknader', label: 'Exportprofil & marknader', icon: 'globe' },
  { id: 'analys', label: 'Informationsgap', icon: 'list-ul' },
  { id: 'dokument', label: 'Dokument', icon: 'file-text' },
  { id: 'historik', label: 'Historik', icon: 'clock' },
  { id: 'installningar', label: 'Bolagsuppgifter', icon: 'gear' }
];

/** Sidomeny per bolag i Export Lab (§ 58) — Movexums blå accent. Ren navigation; RBAC i sidorna + RLS. */
export function ExportSideNav({ startupId }: { startupId: string }) {
  const pathname = usePathname();
  const items = [{ href: '/exportlab', label: 'Alla bolag', icon: 'back' as IconName, exact: true }, ...PAGES.map((p) => ({ href: exportHref(startupId, p.id), label: p.label, icon: p.icon, exact: false }))];
  return (
    <nav aria-label="Export Lab" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-movexum-djupbla text-movexum-vit shadow-sm shadow-movexum-djupbla/30 dark:bg-movexum-bla dark:text-movexum-morkbla'
                : 'text-foreground-muted hover:bg-movexum-pastell-bla hover:text-movexum-morkbla dark:hover:bg-movexum-morkbla/40 dark:hover:text-movexum-pastell-bla'
            }`}
          >
            <Icon name={item.icon} size={16} className={active ? 'text-movexum-vit/90 dark:text-movexum-morkbla' : 'text-movexum-djupbla/70 dark:text-movexum-bla/70'} />
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
