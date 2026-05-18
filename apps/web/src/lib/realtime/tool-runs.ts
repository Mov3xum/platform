'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live-update för bolagets workspace. Eftersom auth-cookien är httpOnly
 * kan PocketBase SSE-subscribe inte autentisera från browsern — vi
 * polerar istället med router.refresh() på tab-focus + intervall.
 *
 * Server actions revalidatePath()-anropar redan rätt routes; den här
 * hooken ser till att fönster som lämnats öppna fångar förändringar
 * inom max `intervalMs` även utan användarinteraktion.
 */
export function useLiveWorkspace(
  active = true,
  intervalMs = 15_000
) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const refresh = () => router.refresh();

    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    const id = window.setInterval(refresh, intervalMs);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [active, intervalMs, router]);
}
