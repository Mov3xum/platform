'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Genomförandestatus från klienten (§ 23.10). En sessionstoken per sidvisning
 * nycklar konversationen; `report` upsertar ett PÅGÅENDE lead när besökaren
 * går vidare ett steg (formulär/quiz), och en pagehide-beacon markerar
 * flödet avbrutet om sidan lämnas innan `markDone()`. Allt är best-effort —
 * flödet stannar aldrig på statusbokföring. Utan `endpointBase` (intern
 * admin-preview) görs inga anrop alls.
 */
export function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `s_${crypto.randomUUID()}`;
  }
  return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function useFlowProgress(opts: {
  endpointBase?: string;
  moduleSlug: string;
  consent?: boolean;
  attribution?: import('@/lib/compass/types').Attribution;
}) {
  const [sessionToken] = useState(generateSessionToken);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const url = useMemo(
    () => (opts.endpointBase ? `${opts.endpointBase}/${encodeURIComponent(opts.moduleSlug)}/progress` : null),
    [opts.endpointBase, opts.moduleSlug]
  );
  const { consent, attribution } = opts;

  const report = useCallback(
    (answers: Record<string, string | string[]>, step: number, total: number) => {
      if (!url || doneRef.current) return;
      startedRef.current = true;
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ sessionToken, event: 'progress', answers, step, total, consent, attribution })
      }).catch(() => {});
    },
    [url, sessionToken, consent, attribution]
  );

  /** Markera att flödet startat (chatten: första turen är redan bokförd server-side). */
  const markStarted = useCallback(() => {
    startedRef.current = true;
  }, []);

  const markDone = useCallback(() => {
    doneRef.current = true;
  }, []);

  useEffect(() => {
    if (!url) return;
    const onLeave = () => {
      if (doneRef.current || !startedRef.current) return;
      const payload = JSON.stringify({ sessionToken, event: 'abandon' });
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
          return;
        }
      } catch {
        // faller tillbaka på fetch nedan
      }
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: payload
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [url, sessionToken]);

  return { sessionToken, report, markStarted, markDone };
}
