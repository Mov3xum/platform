'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';

export interface SwitchableStartup {
  id: string;
  name: string;
  phase?: string;
  industry?: string;
}

interface Props {
  startups: SwitchableStartup[];
  className?: string;
}

function initials(name: string): string {
  return (
    name
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

function deriveCurrentId(pathname: string): string | null {
  const m = pathname.match(/^\/startups\/([^\/]+)(?:\/|$)/);
  if (!m) return null;
  if (m[1] === 'new') return null;
  return m[1];
}

export function StartupSwitcher({ startups, className }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const currentId = deriveCurrentId(pathname);
  const current = currentId ? startups.find((s) => s.id === currentId) : undefined;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function select(id: string) {
    setOpen(false);
    setQ('');
    // Behåll nuvarande tab om vi redan står på en startup-sida
    const m = pathname.match(/^\/startups\/[^\/]+\/(chat|verktyg|logg)/);
    const tail = m ? '/' + m[1] : '';
    router.push(`/startups/${id}${tail}`);
  }

  if (startups.length === 0) return null;

  const filtered = q
    ? startups.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
    : startups;

  const labelText = current
    ? current.name
    : startups.length === 1
      ? startups[0].name
      : 'Välj bolag';
  const subText = current?.phase || (startups.length === 1 ? startups[0].phase : '');

  return (
    <div ref={ref} className={`mx-switcher relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mx-switcher-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mx-switcher-mark">{initials(labelText)}</span>
        <span className="mx-switcher-text">
          <span className="mx-switcher-name">{labelText}</span>
          {subText && <span className="mx-switcher-sub">{subText}</span>}
        </span>
        <span className={`mx-switcher-chev ${open ? 'mx-open' : ''}`}>
          <Icon name="chevdown" size={14} />
        </span>
      </button>

      {open && (
        <div className="mx-switcher-pop">
          <div className="mx-switcher-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sök bolag…"
            />
          </div>
          <div className="mx-switcher-list" role="listbox">
            {filtered.length === 0 ? (
              <div className="mx-switcher-empty">Inga träffar.</div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => select(s.id)}
                  className={`mx-switcher-item ${s.id === currentId ? 'mx-current' : ''}`}
                  role="option"
                  aria-selected={s.id === currentId}
                >
                  <span className="mx-switcher-mark mx-sm">{initials(s.name)}</span>
                  <span className="mx-switcher-text">
                    <span className="mx-switcher-name">{s.name}</span>
                    {(s.phase || s.industry) && (
                      <span className="mx-switcher-sub">
                        {[s.phase, s.industry].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {s.id === currentId && (
                    <span className="mx-switcher-check">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          <Link href="/startups" className="mx-switcher-foot" onClick={() => setOpen(false)}>
            <Icon name="people" size={13} /> Alla bolag
          </Link>
        </div>
      )}
    </div>
  );
}
