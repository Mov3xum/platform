'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

interface Props {
  href: string;
  label: string;
  icon: string;
  count?: number;
}

export function ModuleNavItem({ href, label, icon, count }: Props) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');

  return (
    <Link href={href} className={`mx-rail-item${active ? ' active' : ''}`}>
      <Icon name={icon} size={15} className="mx-ico" />
      <span>{label}</span>
      {count != null && count > 0 && <span className="mx-count">{count}</span>}
    </Link>
  );
}
