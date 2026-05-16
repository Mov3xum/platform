'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { coreModules } from '@platform/shared';
import { Cmdk } from './Cmdk';
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
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
      if (e.key === 'Escape' && cmdkOpen) setCmdkOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdkOpen]);

  return (
    <>
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

        <button className="mx-topbar-search" type="button" onClick={() => setCmdkOpen(true)}>
          <Icon name="search" size={13} />
          <span className="mx-topbar-search-label">Hoppa, hitta, kör…</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="mx-topbar-search-mobile"
          type="button"
          onClick={() => setCmdkOpen(true)}
          aria-label="Sök"
        >
          <Icon name="search" size={18} />
        </button>
      </div>
      <Cmdk open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </>
  );
}
