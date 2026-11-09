'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

interface Props {
  href: string;
  label: string;
  icon: string;
  count?: number;
  /** Markera posten aktiv på hela prefixet (t.ex. Marknadsverktyg → /inflode). */
  activePrefix?: string;
}

export function ModuleNavItem({ href, label, icon, count, activePrefix }: Props) {
  const pathname = usePathname();
  const base = activePrefix ?? href;
  const active = pathname === base || pathname.startsWith(base + '/');

  return (
    <Link href={href} className={`mx-rail-item${active ? ' active' : ''}`}>
      <Icon name={icon} size={15} className="mx-ico" />
      <span>{label}</span>
      {count != null && count > 0 && <span className="mx-count">{count}</span>}
    </Link>
  );
}
