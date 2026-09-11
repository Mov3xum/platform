'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { coreModules } from '@platform/shared';
import { SETTINGS_ROUTE_LABELS } from '@/lib/settings-sections';
import { RailReopenButton } from './MobileRail';

function buildCrumbs(pathname: string): { label: string; href: string; now: boolean }[] {
  if (pathname === '/' || pathname === '/hem') {
    return [{ label: 'Hemmaplan', href: '/hem', now: true }];
  }
  const seg = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href: string; now: boolean }[] = [
    { label: 'Hemmaplan', href: '/hem', now: false }
  ];
  // first segment = module
  const mod = coreModules.find((m) => m.route === '/' + seg[0]);
  if (mod) {
    crumbs.push({ label: mod.title, href: mod.route, now: seg.length === 1 });
  } else {
    crumbs.push({ label: seg[0], href: '/' + seg[0], now: seg.length === 1 });
  }
  // further segments: känd undersida (t.ex. Inställningar-sektion) får sin
  // riktiga titel, övriga visas som avhumaniserade segment.
  for (let i = 1; i < seg.length; i++) {
    const href = '/' + seg.slice(0, i + 1).join('/');
    const known = SETTINGS_ROUTE_LABELS[href];
    crumbs.push({
      label: known ?? decodeURIComponent(seg[i]).replace(/[-_]/g, ' '),
      href,
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
    </div>
  );
}
