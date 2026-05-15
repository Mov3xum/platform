'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { coreModules } from '@platform/shared';
import { Cmdk } from './Cmdk';

interface Props {
  user: { name: string; roles: string[] };
}

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

export function ProtoTopBar({ user }: Props) {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [savedTime, setSavedTime] = useState<string | null>(null);

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

  // Synkad-indikator visar aktuell tid
  useEffect(() => {
    const d = new Date();
    setSavedTime(
      d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    );
  }, [pathname]);

  return (
    <>
      <div className="mx-topbar">
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

        {savedTime && (
          <div className="mx-save-indicator">
            <span className="mx-dot" /> Synkad · {savedTime}
          </div>
        )}

        <button className="mx-topbar-search" type="button" onClick={() => setCmdkOpen(true)}>
          <Icon name="search" size={13} />
          <span>Hoppa, hitta, kör…</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="mx-role-pill" title={user.roles.join(', ')}>
          <span className="mx-dot" />
          {(user.roles[0] || 'user').replace('_', ' ').toUpperCase()}
        </div>

        <Link href="/aktivitet" className="mx-icon-btn" title="Aktivitet & notiser">
          <Icon name="bell" size={15} />
          <span className="mx-dot" />
        </Link>
      </div>
      <Cmdk open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </>
  );
}
