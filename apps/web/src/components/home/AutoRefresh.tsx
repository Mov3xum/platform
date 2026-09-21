'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Håller Dashboard färsk utan att användaren laddar om: server-datan
 * (`router.refresh()`) hämtas om med jämna mellanrum och när fliken blir
 * synlig igen efter att ha legat i bakgrunden. Samma mönster som årshjulets
 * presentationsläge (§ 30.5). Ren klient-bekvämlighet — ingen dataväg.
 */
export function AutoRefresh({ everyMs = 10 * 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      last = Date.now();
      router.refresh();
    };
    const t = setInterval(tick, everyMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > Math.min(everyMs, 3 * 60_000)) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, everyMs]);
  return null;
}
