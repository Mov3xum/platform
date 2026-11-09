'use client';

import { useEffect } from 'react';

/**
 * Noterar att inbjudan öppnats (§ 53.5) — ett POST från webbläsaren, så att
 * mejlskannrar som bara hämtar sidan inte räknas. Fel ignoreras.
 */
export function OpenedBeacon({ token }: { token: string }) {
  useEffect(() => {
    const body = new FormData();
    body.set('t', token);
    fetch('/api/public/e/opened', { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => undefined);
  }, [token]);
  return null;
}
