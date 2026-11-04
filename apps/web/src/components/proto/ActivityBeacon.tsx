'use client';

// Besöksbeacon för användaraktivitet (CLAUDE.md § 57). När sökvägen byter
// MODUL (sida i sidmenyn) skickas modulens id — aldrig sökvägen — till
// /api/activity/visit. Samma modul skickas igen först efter en stund, så ett
// klick fram och tillbaka inom en sida räknas inte som nya besök. Fire-and-
// forget med `keepalive` (överlever en navigering); svaret ignoreras.
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { coreModules, moduleIdForPath } from '@platform/shared';

/** Samma modul rapporteras på nytt först efter så här lång tid. */
const RESEND_AFTER_MS = 5 * 60 * 1000;

export function ActivityBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!pathname) return;
    const moduleId = moduleIdForPath(pathname, coreModules);
    if (!moduleId) return;
    const now = Date.now();
    const prev = lastSent.current.get(moduleId);
    if (prev !== undefined && now - prev < RESEND_AFTER_MS) return;
    lastSent.current.set(moduleId, now);
    try {
      void fetch('/api/activity/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleId }),
        keepalive: true,
        credentials: 'same-origin'
      }).catch(() => undefined);
    } catch {
      /* fail-soft — aktiviteten är aldrig viktigare än sidan */
    }
  }, [pathname]);

  return null;
}
