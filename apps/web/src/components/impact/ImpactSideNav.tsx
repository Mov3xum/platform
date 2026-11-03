'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/proto/Icon';
import { IMPACT_COMPARE_HREF, impactHref, type ImpactPage } from '@/lib/impact/tabs';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Matchas på prefix (sidor under bolaget) eller exakt (Alla bolag/Jämförelser). */
  exact?: boolean;
}

const PAGES: ReadonlyArray<{ id: ImpactPage; label: string; icon: IconName }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'graph' },
  { id: 'installningar', label: 'Bolagsuppgifter', icon: 'gear' },
  { id: 'vasentlighet', label: 'Väsentliga områden', icon: 'briefcase' },
  { id: 'analys', label: 'Informationsgap', icon: 'list-ul' },
  { id: 'dokument', label: 'Dokument', icon: 'file-text' },
  { id: 'historik', label: 'Historik', icon: 'clock' },
  { id: 'anteckningar', label: 'Anteckningar', icon: 'message' }
];

/**
 * Originalets sidomeny per bolag (Alla bolag → Dashboard … Anteckningar +
 * Jämförelser), i Movexums gröna accent. Aktiv post = pastell grön med
 * inåtvänd ring, precis som i originalet. Ren navigation — RBAC ligger i
 * sidorna och RLS (§ 21).
 */
export function ImpactSideNav({ startupId }: { startupId: string }) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: '/impactnavigator', label: 'Alla bolag', icon: 'back', exact: true },
    ...PAGES.map((p) => ({ href: impactHref(startupId, p.id), label: p.label, icon: p.icon })),
    { href: IMPACT_COMPARE_HREF, label: 'Jämförelser', icon: 'target', exact: true }
  ];
  return (
    <nav aria-label="Impact Navigator" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-movexum-pastell-gron text-movexum-morkgron shadow-[inset_0_0_0_1px] shadow-movexum-gron/15 dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:shadow-movexum-ljusgron/20'
                : 'text-foreground-muted hover:bg-canvas-muted hover:text-foreground'
            }`}
          >
            <Icon name={item.icon} size={16} className={active ? 'text-movexum-gron dark:text-movexum-ljusgron' : 'text-foreground-subtle'} />
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
