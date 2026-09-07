'use client';

// Registrerar service workern (public/sw.js) — bara i produktion, så att
// dev-servern och Fast Refresh aldrig fastnar bakom en cache. Vid ny
// deploy tar den nya workern över direkt (SKIP_WAITING + reload en gång)
// så en gammal flik inte kör mot inaktuella statiska filer.
import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Service workers kräver säker kontext (https eller localhost).
    if (!window.isSecureContext) return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {
        /* fail-soft: appen fungerar utan SW */
      });

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  return null;
}
