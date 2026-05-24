'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const MobileRailContext = createContext<Ctx | null>(null);

export function useMobileRail(): Ctx {
  return (
    useContext(MobileRailContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {}
    }
  );
}

export function MobileRailProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      document.body.classList.add('mx-rail-locked');
      window.addEventListener('keydown', onKey);
      return () => {
        document.body.classList.remove('mx-rail-locked');
        window.removeEventListener('keydown', onKey);
      };
    }
  }, [open]);

  return (
    <MobileRailContext.Provider
      value={{ open, setOpen, toggle: () => setOpen(!open) }}
    >
      <div className={`mx-app${open ? ' mx-rail-is-open' : ''}`}>{children}</div>
    </MobileRailContext.Provider>
  );
}

export function MobileRailBackdrop() {
  const { open, setOpen } = useMobileRail();
  return (
    <button
      type="button"
      aria-label="Stäng meny"
      tabIndex={open ? 0 : -1}
      className={`mx-rail-backdrop${open ? ' mx-on' : ''}`}
      onClick={() => setOpen(false)}
    />
  );
}

export function MobileMenuButton() {
  const { toggle, open } = useMobileRail();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? 'Stäng meny' : 'Öppna meny'}
      aria-expanded={open}
      aria-controls="mx-rail"
      className="mx-mobile-menu-btn"
    >
      <Icon name={open ? 'close' : 'menu'} size={20} />
    </button>
  );
}
