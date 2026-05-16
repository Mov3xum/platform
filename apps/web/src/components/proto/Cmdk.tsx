'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { coreModules } from '@platform/shared';

interface Props {
  open: boolean;
  onClose: () => void;
}

type CmdkItem =
  | { kind: 'nav'; label: string; hint: string; href: string; icon: string }
  | { kind: 'act'; label: string; hint: string; href: string };

const ACTIONS: CmdkItem[] = [
  { kind: 'act', label: 'Skapa nytt uppdrag', hint: '⌘N', href: '/uppdrag' },
  { kind: 'act', label: 'Onboarda nytt bolag', hint: '⌘I', href: '/startups/new' },
  { kind: 'act', label: 'Ny rapport', hint: 'Auto', href: '/rapporter' },
  { kind: 'act', label: 'Skapa AI-agent', hint: 'AI-agenter', href: '/toolbox/new' },
  { kind: 'act', label: 'Logga Sprint X-checkin', hint: 'Compass', href: '/kompassen' }
];

const moduleIcons: Record<string, string> = {
  idag: 'home',
  uppdrag: 'flow',
  kompassen: 'compass',
  startups: 'people',
  investerare: 'graph',
  events: 'spark',
  community: 'people',
  education: 'cap',
  rapporter: 'doc',
  agenter: 'bolt',
  integrationer: 'link',
  installningar: 'gear'
};

export function Cmdk({ open, onClose }: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const navItems: CmdkItem[] = useMemo(
    () =>
      coreModules.map((m) => ({
        kind: 'nav' as const,
        label: m.title,
        hint: 'Hoppa',
        href: m.route,
        icon: moduleIcons[m.id] || 'dot'
      })),
    []
  );

  const allItems: CmdkItem[] = useMemo(() => [...navItems, ...ACTIONS], [navItems]);

  const filtered = useMemo(() => {
    const lc = q.toLowerCase().trim();
    if (!lc) return allItems;
    return allItems.filter(
      (it) => it.label.toLowerCase().includes(lc) || (it.hint || '').toLowerCase().includes(lc)
    );
  }, [q, allItems]);

  function run(it: CmdkItem) {
    router.push(it.href);
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[sel]) run(filtered[sel]);
    }
  }

  if (!open) return null;

  const navs = filtered.filter((i) => i.kind === 'nav');
  const acts = filtered.filter((i) => i.kind === 'act');
  let runIdx = -1;

  return (
    <div className="mx-cmdk-shade" onClick={onClose}>
      <div className="mx-cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="mx-cmdk-input"
          placeholder="Sök, navigera eller skapa…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        {navs.length > 0 && (
          <div className="mx-cmdk-section">
            <h6>Hoppa till</h6>
            {navs.map((it) => {
              runIdx++;
              const isSel = runIdx === sel;
              const myIdx = runIdx;
              return (
                <div
                  key={'n' + it.label}
                  className={`mx-cmdk-item${isSel ? ' mx-sel' : ''}`}
                  onClick={() => run(it)}
                  onMouseEnter={() => setSel(myIdx)}
                >
                  <div className="mx-ico-bg">
                    <Icon name={(it as Extract<CmdkItem, { kind: 'nav' }>).icon} size={14} />
                  </div>
                  <span>{it.label}</span>
                  <span className="mx-meta">{it.hint}</span>
                </div>
              );
            })}
          </div>
        )}
        {acts.length > 0 && (
          <div className="mx-cmdk-section">
            <h6>Åtgärder</h6>
            {acts.map((it) => {
              runIdx++;
              const isSel = runIdx === sel;
              const myIdx = runIdx;
              return (
                <div
                  key={'a' + it.label}
                  className={`mx-cmdk-item${isSel ? ' mx-sel' : ''}`}
                  onClick={() => run(it)}
                  onMouseEnter={() => setSel(myIdx)}
                >
                  <div className="mx-ico-bg">
                    <Icon name="bolt" size={14} />
                  </div>
                  <span>{it.label}</span>
                  <span className="mx-meta">{it.hint}</span>
                </div>
              );
            })}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="mx-cmdk-section">
            <div className="mx-cmdk-item" style={{ color: 'var(--mx-muted)' }}>
              Inget hittat.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
