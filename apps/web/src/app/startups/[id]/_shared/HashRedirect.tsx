'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { legacyStartupAnchorTarget } from '@/lib/startup-tabs';

/**
 * Bolagskortet var tidigare en lång sida med ankare (`#de-minimis`,
 * `#agarbild` …). Länkar dit finns kvar i sparade notiser, aktivitetsloggen
 * och bokmärken — på översikten skickas ett känt gammalt ankare vidare till
 * rätt flik (fragmentet når aldrig servern, därför klientsidan).
 */
export function HashRedirect({ startupId }: { startupId: string }) {
  const router = useRouter();
  useEffect(() => {
    const target = legacyStartupAnchorTarget(startupId, window.location.hash, window.location.search);
    if (target) router.replace(target);
  }, [router, startupId]);
  return null;
}
