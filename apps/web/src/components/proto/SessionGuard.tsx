'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Sökvägar som root-layouten renderar UTAN AppShell (spegel av
 * `app/layout.tsx`). Nås någon av dem via en mjuk (klient-)navigering medan
 * skalet redan är monterat, tvingas en hård omladdning.
 */
const SHELL_LESS_PATHS = ['/login', '/offline'];

function isShellLess(pathname: string): boolean {
  return SHELL_LESS_PATHS.includes(pathname) || pathname.startsWith('/m/') || pathname.startsWith('/u/');
}

/**
 * Vakt mot ett "kvarhängande" inloggat skal (incident 2026-09-30).
 *
 * Next.js App Router behåller root-layouten över klient-navigeringar — den
 * renderas bara om vid en hel sidladdning. Har sessionen försvunnit (cookien
 * rensad, token återkallad) svarar nästa sida med `redirect('/login')` via
 * en MJUK navigering: inloggningssidan renderades då INUTI det gamla skalet
 * (sidmeny, namn, bolagsväljare — data från en session som inte längre
 * finns). Vakten ligger i skalet: byter sökvägen till en skal-lös sida görs
 * en hård omladdning så servern renderar om layouten från den faktiska
 * cookien. Ren UX-/hygiendel — säkerhetsgränsen är fortsatt cookie +
 * `getCurrentUser` (fail-closed) + PB-RLS.
 */
export function SessionGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isShellLess(pathname)) return;
    // `replace` — ingen extra historikpost för mellanläget.
    window.location.replace(window.location.href);
  }, [pathname]);

  return null;
}
