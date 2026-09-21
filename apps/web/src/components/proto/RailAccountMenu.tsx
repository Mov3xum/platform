'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { LOGOUT_PATH } from '@/lib/auth-paths';

/**
 * Kontoblocket längst ned i sidmenyn. Hela raden (avatar + namn) är en
 * knapp som öppnar en liten meny med "Mitt konto" och "Logga ut".
 *
 * Tidigare var raden en ren `<div>` och BARA det lilla kugghjulet var en
 * länk — klickade man på sitt namn hände ingenting, och "Logga ut" fanns
 * bara nedanför två formulär på /konto. Att logga ut ska gå från den plats
 * där man ser vem man är inloggad som.
 *
 * Utloggningen är ett vanligt HTML-formulär (`method="post"`) mot route-
 * handlern `/api/auth/logout` — INTE en server action och inte en
 * onClick-fetch. Den fungerar även om JS inte hunnit hydrera, cookien rensas
 * server-side och svaret är en 303 → /login (hård navigering). En server
 * action här slog ut hela sidan i den globala felvyn vid minsta fel i
 * action-rundturen, eftersom railen ligger i root-layouten utanför sidans
 * error.tsx-gräns (t.ex. gammal flik mot ny deploy).
 */

interface Props {
  name: string;
  email: string;
  role?: string;
  initial: string;
}

export function RailAccountMenu({ name, email, role, initial }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Stäng vid navigering (menyn ligger kvar i railen mellan sidor).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="mx-rail-account">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mx-rail-account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        <span className="mx-rail-user-av">{initial}</span>
        <span className="mx-rail-account-text">
          <span className="mx-rail-user-name">{name || email}</span>
          {role && <span className="mx-rail-user-role">{role}</span>}
        </span>
        <span className={`mx-rail-account-chev ${open ? 'mx-open' : ''}`}>
          <Icon name="chevdown" size={13} />
        </span>
      </button>

      {open && (
        <div className="mx-rail-account-pop" role="menu">
          <Link href="/konto" className="mx-rail-account-item" role="menuitem">
            <Icon name="gear" size={13} />
            Mitt konto
          </Link>
          <form method="post" action={LOGOUT_PATH}>
            <button type="submit" className="mx-rail-account-item" role="menuitem">
              <Icon name="logout" size={13} />
              Logga ut
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
