'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions/auth';

type Props = {
  user: {
    name: string;
    email: string;
    tenantName?: string;
    tenantSlug?: string;
    roles: string[];
  };
  modules: { id: string; title: string; route: string }[];
};

export function NavbarMobileMenu({ user, modules }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="navbar-mobile-menu"
        aria-label={open ? 'Stäng meny' : 'Öppna meny'}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-default bg-surface text-foreground transition hover:bg-canvas-subtle md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </>
          ) : (
            <>
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-movexum-svart/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div
        id="navbar-mobile-menu"
        className={`fixed inset-x-0 top-0 z-50 origin-top transform border-b border-default bg-surface shadow-xl shadow-movexum-svart/10 transition md:hidden ${
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center justify-end px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Stäng meny"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-default bg-surface text-foreground transition hover:bg-canvas-subtle"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="border-t border-default px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{user.name}</p>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            {user.tenantName || user.tenantSlug || ''}
            {user.roles.length > 0 && <> · {user.roles.join(', ')}</>}
          </p>
        </div>

        <nav className="flex flex-col gap-1 border-t border-default px-3 py-3">
          {modules.map((m) => (
            <Link
              key={m.id}
              href={m.route}
              className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-canvas-subtle"
            >
              {m.title}
            </Link>
          ))}
        </nav>

        <div
          className="border-t border-default px-4 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-full border border-default bg-surface px-4 py-3 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
            >
              Logga ut
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
