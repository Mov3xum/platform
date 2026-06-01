'use client';

// Route-level felgräns (App Router). Fångar fel som kastas under render/
// hydrering i sidträdet — t.ex. ett klientfel på en redigeringssida — och
// visar en branded återhämtningsvy i stället för Next.js bara vita
// "Application error"-skärm. Layouten (rail/topbar) ligger kvar eftersom
// detta är en segment-gräns, inte global-error.

import { useEffect } from 'react';
import Link from 'next/link';

export default function RouteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logga till browser-konsolen så det faktiska felet går att felsöka
    // (digest mappar mot serverloggen för server-component-fel).
    console.error('[route-error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Något gick fel</h1>
        <p className="mt-3 text-sm text-foreground-muted">
          Ett oväntat fel inträffade när sidan skulle visas. Du kan försöka igen
          eller gå tillbaka. Om felet återkommer, dela gärna detaljerna nedan med
          supporten.
        </p>

        {error?.digest ? (
          <p className="mt-4 inline-block rounded-full bg-canvas-subtle px-3 py-1 font-mono text-xs text-foreground-subtle">
            Felreferens: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            Försök igen
          </button>
          <Link
            href="/education/workshops"
            className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
          >
            Till workshops
          </Link>
        </div>
      </div>
    </main>
  );
}
