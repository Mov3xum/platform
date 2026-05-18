'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { coreModules } from '@platform/shared';
import { MobileMenuButton } from './MobileRail';

function buildCrumbs(pathname: string): { label: string; href: string; now: boolean }[] {
  if (pathname === '/' || pathname === '/idag') {
    return [{ label: 'Hemmaplan', href: '/idag', now: true }];
  }
  const seg = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string; now: boolean }[] = [
    { label: 'Hemmaplan', href: '/idag', now: false }
  ];
  // first segment = module
  const mod = coreModules.find((m) => m.route === '/' + seg[0]);
  if (mod) {
    crumbs.push({ label: mod.title, href: mod.route, now: seg.length === 1 });
  } else {
    crumbs.push({ label: seg[0], href: '/' + seg[0], now: seg.length === 1 });
  }
  // further segments shown as plain labels
  for (let i = 1; i < seg.length; i++) {
    crumbs.push({
      label: decodeURIComponent(seg[i]).replace(/[-_]/g, ' '),
      href: '/' + seg.slice(0, i + 1).join('/'),
      now: i === seg.length - 1
    });
  }
  return crumbs;
}

export function ProtoTopBar() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);

  return (
    <div className="mx-topbar">
      <MobileMenuButton />
      <div className="mx-crumb">
        {crumbs.map((c, i) => (
          <span key={c.href + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span className="mx-sep">/</span>}
            <Link href={c.href} className={`mx-seg${c.now ? ' now' : ''}`}>
              {c.label}
            </Link>
          </span>
        ))}
      </div>

      <div className="mx-topbar-spacer" />
    </div>
  );
}
